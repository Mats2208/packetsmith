// El bucle de agente.
//
// Esto es lo que hasta ahora hacía el CLI de Claude por nosotros: mandar el
// mensaje, ver que el modelo pide una tool, ejecutarla contra Packet Tracer,
// devolverle el resultado, y repetir hasta que conteste. PacketSmith deja de
// envolver un agente y pasa a ser uno.
//
// Lo que se gana no es solo "otro modelo": el prompt de sistema es NUESTRO
// —antes se colgaba del de Claude Code, que habla de editar archivos y de git—,
// las tools son las que elijamos, y el bucle es inspeccionable.
//
// Emite exactamente el mismo `AgentEvent` que el adapter del CLI, así que la
// interfaz entera funciona sin enterarse de cuál de los dos está corriendo.
import type { AgentEvent, Effort } from "./types.ts"
import type { McpClient } from "../mcp/client.ts"
import { textoDeContenido } from "../mcp/client.ts"
import {
  turno as turnoOpenAI,
  type Mensaje, type ProviderConfig, type ToolCallHecha, type ToolSpec, type Turno,
} from "./providers/openai-compat.ts"
import { turno as turnoAnthropic } from "./providers/anthropic-messages.ts"
import { turno as turnoResponses } from "./providers/openai-responses.ts"

/**
 * Lo que devuelve un turno, hable el dialecto que hable.
 *
 * `bloques` solo lo trae el de Anthropic —son sus bloques crudos, con la firma
 * del razonamiento— y por eso es opcional: el bucle lo guarda si está y no
 * pregunta con quién está hablando.
 */
type FinDeTurno = Turno & { bloques?: unknown[] }

/**
 * Tope de vueltas por turno.
 *
 * Un build real encadena decenas de `pt_add_device` y `pt_add_link`, así que
 * tiene que ser generoso. Pero tiene que existir: un modelo que se traba
 * llamando la misma tool gastaría la cuota entera sin que nadie lo pare.
 */
const MAX_VUELTAS = 60

export interface AgentOpts {
  provider: ProviderConfig
  /**
   * Qué dialecto habla el proveedor.
   *
   * No son variantes del mismo formato: `system` va en otro lado, las tools se
   * declaran distinto y el streaming va por bloques en vez de por deltas de
   * `choices`. Los planes de suscripción de coding suelen exponer el de
   * Anthropic o el de Responses; las APIs por token, el de OpenAI.
   */
  protocolo?: "openai" | "anthropic" | "responses"
  mcp: McpClient
  systemPrompt: string
  /** Cuánto razona. Se traduce a lo que entienda el proveedor. */
  effort?: Effort
  /** Precio por millón de tokens, para el contador de la barra. */
  precio?: { entrada: number; salida: number }
  /** Tamaño de la ventana, para el medidor de contexto. */
  contextWindow?: number
}

/**
 * Una conversación viva contra un proveedor propio.
 *
 * Guarda los mensajes porque acá no hay un CLI que lleve la cuenta: el historial
 * es nuestro, y es lo que se le manda entero en cada vuelta.
 */
export class Agent {
  private readonly mensajes: Mensaje[] = []
  private readonly cola: string[] = []
  private despertar: (() => void) | undefined
  private cerrado = false
  private abort: AbortController | undefined

  constructor(private readonly opts: AgentOpts) {
    this.mensajes.push({ role: "system", content: opts.systemPrompt })
  }

  /** Encola un mensaje. Falso si la sesión ya no acepta nada. */
  send(text: string): boolean {
    if (this.cerrado) return false
    this.cola.push(text)
    this.despertar?.()
    return true
  }

  close(): void {
    this.cerrado = true
    this.abort?.abort()
    this.despertar?.()
    this.opts.mcp.close()
  }

  /** Las tools del MCP, traducidas al formato del proveedor. */
  private specs(): ToolSpec[] {
    return this.opts.mcp.tools.map((t) => ({
      name: t.name,
      description: t.description,
      // El esquema viene del servidor tal cual. Acá no se declara ninguna tool.
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    }))
  }

  async *events(): AsyncIterable<AgentEvent> {
    yield {
      type: "ready",
      sessionId: "local",
      model: this.opts.provider.model,
      tools: this.opts.mcp.tools.map((t) => t.name),
    }

    while (!this.cerrado) {
      const texto = this.cola.shift()
      if (texto === undefined) {
        await new Promise<void>((r) => (this.despertar = r))
        this.despertar = undefined
        continue
      }

      this.mensajes.push({ role: "user", content: texto })
      try {
        yield* this.unTurno()
      } catch (e) {
        yield { type: "error", message: e instanceof Error ? e.message : String(e) }
        yield { type: "phase", phase: "idle" }
      }
    }
  }

  /** Un turno completo: puede dar varias vueltas si el modelo pide tools. */
  private async *unTurno(): AsyncGenerator<AgentEvent> {
    this.abort = new AbortController()
    let costo = 0
    let ultimoUso: { entrada: number; salida: number } | undefined
    let respuesta = ""

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      yield { type: "phase", phase: "requesting" }

      const hablar = this.opts.protocolo === "anthropic" ? turnoAnthropic
        : this.opts.protocolo === "responses" ? turnoResponses
        : turnoOpenAI
      const stream = hablar(this.opts.provider, this.mensajes, this.specs(), this.abort.signal)
      let razonando = 0
      let escribiendo = false
      let r: IteratorResult<any, any>

      // Se itera a mano y no con `for await` porque hace falta el valor de
      // RETORNO del generador —el resumen del turno—, y `for await` lo tira.
      while (!(r = await stream.next()).done) {
        const t = r.value
        if (t.tipo === "razonando") {
          if (!razonando) yield { type: "phase", phase: "thinking" }
          // No hay conteo de tokens de razonamiento en esta API, así que se
          // estima por caracteres: sirve igual como prueba de vida, que es
          // para lo único que se muestra.
          razonando += t.delta.length
          yield { type: "thinking", tokens: Math.round(razonando / 4) }
        }
        if (t.tipo === "texto") {
          if (!escribiendo) { escribiendo = true; yield { type: "phase", phase: "writing" } }
          respuesta += t.delta
          yield { type: "text", delta: t.delta }
        }
        if (t.tipo === "uso") ultimoUso = { entrada: t.entrada, salida: t.salida }
      }

      const fin = r.value as FinDeTurno
      if (fin.uso) ultimoUso = fin.uso
      if (ultimoUso && this.opts.precio) {
        costo += (ultimoUso.entrada * this.opts.precio.entrada +
          ultimoUso.salida * this.opts.precio.salida) / 1_000_000
      }

      // Sin tools que ejecutar, el turno cerró.
      if (fin.motivo !== "tool_calls" || !fin.calls.length) {
        yield {
          type: "turn_end",
          costUsd: costo,
          text: fin.texto || respuesta,
          ...(ultimoUso && this.opts.contextWindow
            ? { usage: { tokens: ultimoUso.entrada + ultimoUso.salida, contextWindow: this.opts.contextWindow } }
            : {}),
        }
        yield { type: "phase", phase: "idle" }
        return
      }

      // El mensaje del asistente CON sus tool_calls tiene que quedar en el
      // historial antes de los resultados, o la API rechaza el próximo pedido.
      // Los bloques crudos van si el proveedor los dio: con razonamiento
      // extendido hay que devolverlos con su firma o el pedido siguiente falla.
      this.mensajes.push({
        role: "assistant",
        content: fin.texto,
        tool_calls: fin.calls,
        ...(fin.bloques?.length ? { bloques: fin.bloques } : {}),
      })

      for (const call of fin.calls) {
        yield* this.ejecutar(call)
      }
    }

    yield {
      type: "error",
      message: `el modelo pidió tools ${MAX_VUELTAS} veces seguidas sin contestar; se cortó el turno`,
    }
    yield { type: "phase", phase: "idle" }
  }

  /** Corre una tool contra el MCP y le devuelve el resultado al modelo. */
  private async *ejecutar(call: ToolCallHecha): AsyncGenerator<AgentEvent> {
    const nombre = call.function.name
    yield { type: "phase", phase: "tool", detail: nombre }

    let args: unknown = {}
    try {
      args = JSON.parse(call.function.arguments)
    } catch { /* ya se validó al cerrar el stream; acá no puede pasar */ }

    yield { type: "tool_start", id: call.id, name: nombre, input: args }

    let salida: unknown
    let fallo = false
    try {
      const r = await this.opts.mcp.call(nombre, args)
      salida = r.content
      fallo = r.isError
    } catch (e) {
      salida = e instanceof Error ? e.message : String(e)
      fallo = true
    }

    yield { type: "tool_end", id: call.id, name: nombre, output: salida, isError: fallo }

    // El resultado vuelve al modelo como texto. Que una tool falle no corta el
    // turno: el modelo tiene que ENTERARSE del error para poder corregir, que es
    // media gracia de tener un agente.
    this.mensajes.push({
      role: "tool",
      tool_call_id: call.id,
      content: (fallo ? "ERROR: " : "") + textoDeContenido(salida),
    })
  }
}
