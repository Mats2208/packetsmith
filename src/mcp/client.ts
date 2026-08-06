// Cliente MCP por stdio.
//
// Es lo que permite que PacketSmith maneje Packet Tracer sin el CLI de Claude
// en el medio, y sin copiar una sola línea del servidor.
//
// La idea que hace que esto valga la pena: las tools NO se declaran acá. Se le
// preguntan al servidor con `tools/list` y vienen con su JSON Schema puesto,
// que es exactamente el formato que piden OpenAI y compañía para function
// calling. Cuando MCP-Packet-Tracer agregue la tool 62, aparece sola — sin
// tocar este repo, sin versión que sincronizar, sin módulo espejo.
//
// Sobre el puerto 54321: el servidor de Python es el que lo ABRE (Packet Tracer
// solo le postea los resultados de vuelta), así que dos servidores vivos se
// pelean. Por eso este cliente levanta UNO y es el único: cuando PacketSmith es
// el agente, el CLI de Claude no está corriendo y no hay con quién chocar.
import { spawn, type Subprocess } from "bun"
import { jsonLines } from "../engine/stream.ts"

/** Una tool tal como la describe el servidor. El esquema viene de él. */
export interface McpTool {
  name: string
  description?: string
  /** JSON Schema de los parámetros, listo para mandarle al modelo. */
  inputSchema: Record<string, unknown>
}

/** Cómo levantar el servidor. Sale de la config del CLI, no de acá. */
export interface McpServerSpec {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface Pendiente {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** Cuánto se espera una respuesta. `pt_live_deploy` de 40 nodos tarda. */
const TIMEOUT_MS = 180_000

export class McpClient {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | undefined
  private readonly pendientes = new Map<number, Pendiente>()
  private siguienteId = 1
  private cerrado = false
  private lector: Promise<void> | undefined

  /** Las tools que informó el servidor. Vacío hasta que se conecta. */
  tools: McpTool[] = []
  /** Nombre y versión, para `/debug`. */
  info: { name?: string; version?: string } = {}

  /**
   * Levanta el servidor y hace el handshake.
   *
   * Devuelve las tools que declaró. Si algo falla, tira: arrancar sin tools es
   * peor que no arrancar, porque la app parecería andar y el agente estaría
   * mudo delante de Packet Tracer.
   */
  async connect(spec: McpServerSpec): Promise<McpTool[]> {
    this.proc = spawn([spec.command, ...(spec.args ?? [])], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
    }) as Subprocess<"pipe", "pipe", "pipe">

    this.lector = this.leer()

    const init = await this.pedir("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "packetsmith", version: "0.2" },
    }) as { serverInfo?: { name?: string; version?: string } }
    this.info = init?.serverInfo ?? {}

    // El servidor espera esta notificación antes de aceptar pedidos.
    this.notificar("notifications/initialized")

    const lista = await this.pedir("tools/list", {}) as { tools?: McpTool[] }
    this.tools = lista?.tools ?? []
    return this.tools
  }

  /** Ejecuta una tool. Devuelve el contenido crudo, tal como lo manda el MCP. */
  async call(name: string, args: unknown): Promise<{ content: unknown; isError: boolean }> {
    const r = await this.pedir("tools/call", { name, arguments: args ?? {} }) as {
      content?: unknown
      isError?: boolean
    }
    return { content: r?.content, isError: r?.isError === true }
  }

  close(): void {
    this.cerrado = true
    for (const [, p] of this.pendientes) p.reject(new Error("MCP cerrado"))
    this.pendientes.clear()
    try { this.proc?.stdin.end() } catch { /* ya estaba */ }
    this.proc?.kill()
  }

  // ── Transporte ───────────────────────────────────────────────────────────

  private async leer(): Promise<void> {
    if (!this.proc) return
    try {
      for await (const raw of jsonLines(this.proc.stdout)) {
        const m = raw as Record<string, any>
        // Las notificaciones del servidor no llevan id y no se esperan.
        if (typeof m.id !== "number") continue
        const p = this.pendientes.get(m.id)
        if (!p) continue
        this.pendientes.delete(m.id)
        if (m.error) p.reject(new Error(`${m.error.code}: ${m.error.message}`))
        else p.resolve(m.result)
      }
    } catch (e) {
      for (const [, p] of this.pendientes) {
        p.reject(e instanceof Error ? e : new Error(String(e)))
      }
      this.pendientes.clear()
      return
    }
    // El stdout se acabó: el servidor murió. Sin esto, cualquier pedido en
    // vuelo se quedaba esperando el timeout completo en vez de fallar ya.
    if (!this.cerrado) {
      const err = await new Response(this.proc.stderr).text()
      for (const [, p] of this.pendientes) {
        p.reject(new Error(`el servidor MCP terminó: ${err.slice(0, 300) || "sin stderr"}`))
      }
      this.pendientes.clear()
    }
  }

  private escribir(msg: unknown): void {
    if (!this.proc || this.cerrado) throw new Error("MCP cerrado")
    this.proc.stdin.write(JSON.stringify(msg) + "\n")
    this.proc.stdin.flush()
  }

  private notificar(method: string, params: unknown = {}): void {
    this.escribir({ jsonrpc: "2.0", method, params })
  }

  private pedir(method: string, params: unknown): Promise<unknown> {
    const id = this.siguienteId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendientes.delete(id)
        reject(new Error(`${method} no contestó en ${TIMEOUT_MS / 1000}s`))
      }, TIMEOUT_MS)

      this.pendientes.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })

      try {
        this.escribir({ jsonrpc: "2.0", id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.pendientes.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }
}

/**
 * Aplana el `content` de un tool_result a texto.
 *
 * El MCP devuelve una lista de bloques `{type, text}`. El panel de topología ya
 * sabe destapar lo que venga (`unwrapToolOutput`), pero el modelo necesita
 * texto plano, así que se junta acá.
 */
export function textoDeContenido(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? "")
  return content
    .map((b) => (typeof b === "object" && b && "text" in b ? String((b as any).text) : JSON.stringify(b)))
    .join("")
}
