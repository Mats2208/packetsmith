// Registry de motores.
//
// Los que hay son de DOS clases distintas, y conviene tenerlo claro:
//
//   · `claude` ENVUELVE un agente que ya existe. El CLI hace el bucle, habla
//     con el MCP y resuelve permisos; nosotros leemos su stream. Es el único
//     camino para aprovechar una suscripción Pro/Max, porque esa suscripción no
//     tiene API — ni opencode encontró la vuelta.
//   · Los demás SON el agente. Levantan el MCP, corren el bucle y hablan HTTP
//     directo. Piden una API key, y dan a cambio el prompt de sistema entero,
//     las tools que elijamos y un bucle que se puede mirar por dentro. Salen
//     todos de una tabla —`providers/catalog.ts`— porque hablan el mismo
//     protocolo: agregar uno cuesta cinco líneas.
//
// Todos emiten el mismo `AgentEvent`, así que la interfaz no sabe cuál corre.
import type { Engine } from "./types.ts"
import { claude } from "./claude.ts"
import { MOTORES_HTTP } from "./openai-engine.ts"

export const engines: Record<string, Engine> = { claude, ...MOTORES_HTTP }

export function getEngine(name: string): Engine {
  const e = engines[name]
  if (!e) {
    throw new Error(
      `Motor desconocido: "${name}". Disponibles: ${Object.keys(engines).join(", ")}`,
    )
  }
  return e
}

export type { AgentEvent, Engine, Session, StartOpts } from "./types.ts"
