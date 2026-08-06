// Registry de motores. Agregar uno = un archivo + una línea acá.
//
// Los dos que hay no son variantes del mismo diseño, y conviene tenerlo claro:
//
//   · `claude` ENVUELVE un agente que ya existe. El CLI hace el bucle, habla
//     con el MCP y resuelve permisos; nosotros leemos su stream. Es el único
//     camino para aprovechar una suscripción Pro/Max, porque esa suscripción no
//     tiene API — ni opencode encontró la vuelta.
//   · `kimi` ES el agente. Levanta el MCP, corre el bucle y habla HTTP directo.
//     A cambio pide una API key, y da a cambio el prompt de sistema entero, las
//     tools que elijamos y un bucle que se puede mirar por dentro.
//
// Los dos emiten el mismo `AgentEvent`, así que la interfaz no sabe cuál corre.
import type { Engine } from "./types.ts"
import { claude } from "./claude.ts"
import { kimi } from "./kimi.ts"

export const engines = { claude, kimi } satisfies Record<string, Engine>

export type EngineName = keyof typeof engines

export function getEngine(name: string): Engine {
  const e = engines[name as EngineName]
  if (!e) {
    throw new Error(
      `Motor desconocido: "${name}". Disponibles: ${Object.keys(engines).join(", ")}`,
    )
  }
  return e
}

export type { AgentEvent, Engine, Session, StartOpts } from "./types.ts"
