// Un motor por proveedor.
//
// Un motor = un proveedor, no un endpoint. Cuál de sus PLANES usa sale de
// `auth.json`, y por eso Kimi es un motor con dos planes adentro en vez de dos
// motores que parecen empresas distintas.
//
// Todos levantan el servidor MCP REAL y le preguntan sus tools. Ninguno copia
// nada de Packet Tracer.
import { homedir } from "node:os"
import type { Engine, Session, StartOpts } from "./types.ts"
import { Agent } from "./agent.ts"
import { McpClient } from "../mcp/client.ts"
import { serverSpec } from "./mcp.ts"
import { systemPrompt } from "./prompt.ts"
import { dondeBuscar, hayCredencial, planElegido } from "../auth.ts"
import {
  findPlan, modelosDelPlan, modelosDeLaApi, todosLosProveedores, type Plan, type Provider,
} from "./providers/catalog.ts"
import { resolverCredencial } from "./providers/credencial.ts"
import { infoDeModelo } from "./providers/models-dev.ts"
import type { Medida } from "./providers/usage.ts"

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

/** El plan en uso: el elegido en `/connect`, o el primero del proveedor. */
function planActivo(p: Provider): Plan {
  return findPlan(p.id, planElegido(p.id))!
}

export function motorDe(p: Provider): Engine {
  // Los modelos que informó la API la última vez que hubo una sesión. Se cachea
  // acá y no adentro de `start` porque `/model` los pide entre sesiones.
  let modelosVivos: string[] = []

  return {
    name: p.id,

    // Sin precio por millón no hay cuánto contar: es una suscripción.
    get sinCostoPorToken() { return !planActivo(p).precio },

    // Solo se nombra si hay más de uno: con una sola puerta, decir cuál es ruido.
    planActual: () => (p.planes.length > 1 ? planActivo(p).id : undefined),

    models() {
      const plan = planActivo(p)
      const lista = modelosVivos.length ? modelosVivos : modelosDelPlan(plan)
      return lista.map((value) => {
        // Lo que models.dev sepa del modelo se muestra al lado: el contexto es
        // lo que más cambia entre uno y otro, y es lo que decide si te entra la
        // topología entera.
        const info = plan.modelsDev ? infoDeModelo(plan.modelsDev, value) : undefined
        const ctx = info?.contextWindow ? `${Math.round(info.contextWindow / 1000)}k` : ""
        const precio = info ? (info.precio ? `$${info.precio.entrada}/${info.precio.salida}` : "incluido") : ""
        const desc = [ctx, precio, info?.razona ? "razona" : ""].filter(Boolean).join(" · ")
        return desc ? { value, description: desc } : { value }
      })
    },

    describe() {
      const spec = serverSpec(homedir(), process.cwd())
      const plan = planActivo(p)
      return {
        proveedor: p.label,
        plan: plan.label,
        API: plan.baseUrl,
        protocolo: plan.protocolo ?? "openai",
        // Dice SI hay credencial, jamás cuál.
        credencial: hayCredencial(p.id)
          ? (plan.auth === "chatgpt" ? "sesión de ChatGPT" : "key encontrada")
          : `FALTA — /connect, o ${dondeBuscar(p.id)}`,
        MCP: spec ? `${spec.command} ${(spec.args ?? []).join(" ")}`.slice(0, 60) : "no registrado",
      }
    },

    /** Cuánto va consumido del plan, si publica un medidor. */
    async uso(): Promise<Medida | undefined> {
      const plan = planActivo(p)
      if (!plan.medidor) return undefined
      const cred = await resolverCredencial(p.id, plan).catch(() => undefined)
      return cred ? plan.medidor(cred) : undefined
    },

    start(opts: StartOpts): Session {
      const plan = planActivo(p)
      const spec = serverSpec(homedir(), opts.cwd ?? process.cwd())
      const model = opts.model || plan.porDefecto

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
        const cred = await resolverCredencial(p.id, plan)
        if (!cred) {
          throw new Error(
            plan.auth === "chatgpt"
              ? `no hay sesión de ChatGPT. Poné \`/connect\` y elegí "${plan.label}".`
              : `falta la API key de ${p.label} (${plan.label}). Poné \`/connect\` acá mismo, ` +
                `o una de estas variables: ${plan.env.join(", ")}. Se sacan en ${plan.consola}`)
        }
        if (!spec) {
          throw new Error(
            "el MCP de Packet Tracer no está registrado. Corré `bun run setup`, " +
            "o `claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio`.")
        }

        await mcp.connect(spec)

        // Se le pregunta la lista de modelos en segundo plano: es un dato para
        // el próximo `/model`, no algo que valga la pena esperar acá.
        void modelosDeLaApi(plan, cred.token).then((m) => { if (m.length) modelosVivos = m })

        // Lo que models.dev sepa del modelo GANA sobre lo del plan: el contexto
        // es por modelo, no por proveedor, y un medidor calibrado con el número
        // equivocado miente más callado que no tenerlo.
        const info = plan.modelsDev ? infoDeModelo(plan.modelsDev, model) : undefined
        const precio = info?.precio ?? plan.precio

        agent = new Agent({
          provider: {
            baseUrl: plan.baseUrl,
            apiKey: cred.token,
            model,
            headers: {
              ...plan.headers,
              // El plan de ChatGPT exige saber de qué cuenta es la sesión.
              ...(cred.accountId ? { "ChatGPT-Account-Id": cred.accountId } : {}),
            },
            // Responses no lleva `max_tokens`: Codex directamente no lo manda,
            // y se le copia porque ese endpoint es el suyo.
            body: plan.protocolo === "responses"
              ? {}
              : { max_tokens: TOPE[opts.effort ?? "medium"] ?? TOPE.medium },
          },
          ...(plan.protocolo ? { protocolo: plan.protocolo } : {}),
          mcp,
          systemPrompt: systemPrompt(opts.lang ?? "en"),
          contextWindow: info?.contextWindow ?? plan.contextWindow,
          ...(precio ? { precio } : {}),
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

/**
 * Un motor por proveedor, listo para el registro.
 *
 * Se arma al importar, con la copia de models.dev que haya en disco. Si todavía
 * no hay ninguna —primer arranque, sin red— quedan los curados, que es
 * exactamente lo que había antes; la próxima vez ya están los ciento y pico.
 */
export const MOTORES_HTTP: Record<string, Engine> = Object.fromEntries(
  todosLosProveedores().map((p) => [p.id, motorDe(p)]),
)
