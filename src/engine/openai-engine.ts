// Un motor por cada proveedor compatible con OpenAI.
//
// Antes esto era `kimi.ts` a mano. Ahora es una fábrica sobre el catálogo: todos
// hablan el mismo protocolo, así que el único código específico de un proveedor
// es su fila en la tabla. Agregar uno cuesta cinco líneas.
//
// Todos levantan el servidor MCP REAL y le preguntan sus tools. Ninguno copia
// nada de Packet Tracer.
import { homedir } from "node:os"
import type { Engine, Session, StartOpts } from "./types.ts"
import { Agent } from "./agent.ts"
import { McpClient } from "../mcp/client.ts"
import { serverSpec } from "./mcp.ts"
import { systemPrompt } from "./prompt.ts"
import { apiKey, dondeBuscar } from "../auth.ts"
import { modelosDeLaApi, PROVIDERS, type Provider } from "./providers/catalog.ts"

/**
 * Cuánto razona, traducido a lo que entienden estas APIs.
 *
 * No tienen niveles de esfuerzo como el CLI de Claude, así que se mapea a
 * cuánto los dejamos escribir. NO es lo mismo y está dicho a propósito: es la
 * aproximación honesta, no una equivalencia.
 */
const TOPE: Record<string, number> = {
  low: 2_048, medium: 8_192, high: 16_384, xhigh: 32_768, max: 65_536,
}

export function motorDe(p: Provider): Engine {
  // Los modelos que informó la API la última vez que hubo una sesión. Se cachea
  // acá y no adentro de `start` porque `/model` los pide entre sesiones.
  let modelosVivos: string[] = []

  return {
    name: p.id,

    models: () => (modelosVivos.length ? modelosVivos : p.modelos).map((value) => ({ value })),

    describe() {
      const spec = serverSpec(homedir(), process.cwd())
      return {
        proveedor: p.label,
        API: p.baseUrl,
        // Dice SI hay key, jamás cuál.
        key: apiKey(p.id) ? "encontrada" : `FALTA — /connect, o ${dondeBuscar(p.id)}`,
        MCP: spec ? `${spec.command} ${(spec.args ?? []).join(" ")}`.slice(0, 60) : "no registrado",
      }
    },

    start(opts: StartOpts): Session {
      const key = apiKey(p.id)
      const spec = serverSpec(homedir(), opts.cwd ?? process.cwd())
      const model = opts.model || p.porDefecto

      const mcp = new McpClient()
      let agent: Agent | undefined
      const pendientes: string[] = []
      let muerto = false

      /**
       * Se conecta al MCP y arma el agente.
       *
       * `start` es síncrono para todos los motores, así que lo que se mande
       * antes de que esto termine se guarda y se entrega después. En la
       * práctica el handshake tarda menos que escribir la primera frase.
       */
      const arranque = (async () => {
        if (!key) {
          throw new Error(
            `falta la API key de ${p.label}. Poné \`/connect\` acá mismo, ` +
            `o una de estas variables: ${p.env.join(", ")}. Se sacan en ${p.consola}`)
        }
        if (!spec) {
          throw new Error(
            "el MCP de Packet Tracer no está registrado. Corré `bun run setup`, " +
            "o `claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio`.")
        }

        await mcp.connect(spec)

        // Se le pregunta la lista de modelos en segundo plano: es un dato para
        // el próximo `/model`, no algo que valga la pena esperar acá.
        void modelosDeLaApi(p, key).then((m) => { if (m.length) modelosVivos = m })

        agent = new Agent({
          provider: {
            baseUrl: p.baseUrl,
            apiKey: key,
            model,
            ...(p.headers ? { headers: p.headers } : {}),
            body: { max_tokens: TOPE[opts.effort ?? "medium"] ?? TOPE.medium },
          },
          mcp,
          systemPrompt: systemPrompt(opts.lang ?? "en"),
          contextWindow: p.contextWindow,
          ...(p.precio ? { precio: p.precio } : {}),
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
}

/** Un motor por proveedor del catálogo, listo para el registro. */
export const MOTORES_HTTP: Record<string, Engine> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, motorDe(p)]),
)
