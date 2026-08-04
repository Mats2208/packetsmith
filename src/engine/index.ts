// Registry de motores. Agregar uno = un archivo + una línea acá.
import type { Engine } from "./types.ts"
import { claude } from "./claude.ts"

export const engines = { claude } satisfies Record<string, Engine>

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
