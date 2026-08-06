// Motor propio: Kimi (Moonshot) hablando HTTP directo, sin CLI en el medio.
//
// Es el primer motor que NO envuelve a otro agente. PacketSmith levanta el
// servidor MCP real, le pregunta qué tools tiene, y corre el bucle él mismo.
//
// Sobre el puerto 54321: el servidor de Python es el que lo abre, así que dos
// vivos se pelean. Con este motor hay UNO —el que levantamos acá— porque el CLI
// de Claude no está corriendo. La regla de "la TUI nunca habla con el MCP"
// valía mientras hubiera un CLI en el medio; sin él, se cae sola.
import { homedir } from "node:os"
import type { Engine, Session, StartOpts } from "./types.ts"
import { Agent } from "./agent.ts"
import { McpClient } from "../mcp/client.ts"
import { serverSpec } from "./mcp.ts"
import { systemPrompt } from "./prompt.ts"
import { apiKey, dondeBuscar } from "../auth.ts"

const BASE_URL = process.env.PACKETSMITH_KIMI_URL || "https://api.moonshot.ai/v1"

/**
 * Los modelos que se ofrecen y lo que cuestan.
 *
 * El precio va acá y no se le pregunta a la API porque Moonshot no lo publica
 * por endpoint. Es solo para el contador de la barra: si queda viejo, el número
 * miente un poco; si no estuviera, no habría número.
 */
const MODELOS: Record<string, { contextWindow: number; entrada: number; salida: number }> = {
  "kimi-k2-turbo-preview": { contextWindow: 256_000, entrada: 0.6, salida: 2.5 },
  "kimi-k2-0905-preview": { contextWindow: 256_000, entrada: 0.6, salida: 2.5 },
  "moonshot-v1-128k": { contextWindow: 128_000, entrada: 2, salida: 5 },
  "moonshot-v1-32k": { contextWindow: 32_000, entrada: 1, salida: 3 },
}

const POR_DEFECTO = "kimi-k2-turbo-preview"

/**
 * Cuánto razona, traducido a lo que entiende la API.
 *
 * Kimi no tiene niveles como el CLI de Claude, así que el esfuerzo se mapea a
 * cuánto lo dejamos pensar y escribir. No es lo mismo, y por eso está dicho:
 * es la aproximación honesta, no una equivalencia.
 */
const TOPE: Record<string, number> = {
  low: 2_048, medium: 8_192, high: 16_384, xhigh: 32_768, max: 65_536,
}

export const kimi: Engine = {
  name: "kimi",

  models: () => Object.entries(MODELOS).map(([value, m]) => ({
    value,
    description: `${(m.contextWindow / 1000) | 0}k de contexto`,
  })),

  describe() {
    const spec = serverSpec(homedir(), process.cwd())
    return {
      "API": BASE_URL,
      "key": apiKey("kimi") ? "encontrada" : `FALTA — poné ${dondeBuscar("kimi")}`,
      "MCP": spec ? `${spec.command} ${(spec.args ?? []).join(" ")}`.slice(0, 60) : "no registrado",
    }
  },

  start(opts: StartOpts): Session {
    const key = apiKey("kimi")
    const spec = serverSpec(homedir(), opts.cwd ?? process.cwd())
    const model = opts.model && MODELOS[opts.model] ? opts.model : POR_DEFECTO
    const info = MODELOS[model]!

    const mcp = new McpClient()
    let agent: Agent | undefined
    const pendientes: string[] = []
    let muerto = false

    /**
     * Se conecta al MCP y arma el agente.
     *
     * Es asíncrono y `start` no puede serlo —el contrato de `Engine` es
     * síncrono para todos los motores—, así que lo que se mande antes de que
     * termine se guarda y se entrega después. En la práctica el handshake tarda
     * menos que lo que tarda alguien en escribir la primera frase.
     */
    const arranque = (async () => {
      if (!key) throw new Error(`falta la API key de Kimi. Poné ${dondeBuscar("kimi")}`)
      if (!spec) {
        throw new Error(
          "el MCP de Packet Tracer no está registrado. Corré `bun run setup`, " +
          "o `claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio`.")
      }
      await mcp.connect(spec)
      agent = new Agent({
        provider: {
          baseUrl: BASE_URL,
          apiKey: key,
          model,
          body: { max_tokens: TOPE[opts.effort ?? "medium"] ?? TOPE.medium },
        },
        mcp,
        systemPrompt: systemPrompt(opts.lang ?? "en"),
        contextWindow: info.contextWindow,
        precio: { entrada: info.entrada, salida: info.salida },
      })
      for (const t of pendientes) agent.send(t)
      pendientes.length = 0
      return agent
    })()

    return {
      send(text: string): boolean {
        if (muerto) return false
        if (agent) return agent.send(text)
        pendientes.push(text)
        return true
      },

      async *events() {
        try {
          const a = await arranque
          yield* a.events()
        } catch (e) {
          muerto = true
          yield { type: "error", message: e instanceof Error ? e.message : String(e) }
        }
      },

      close() {
        muerto = true
        agent?.close()
        mcp.close()
      },
    }
  },
}

/** Los modelos que este motor ofrece, para `/model`. */
export const KIMI_MODELS = Object.keys(MODELOS)
