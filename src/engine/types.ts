// Contrato común a todos los motores. Un adapter traduce lo que emite SU CLI a
// este union; de ahí para arriba nadie sabe si corre claude, codex u opencode.

export interface StartOpts {
  model?: string
  /** Lista blanca de tools. `undefined` = las que el CLI traiga por defecto. */
  allowedTools?: string[]
  cwd?: string
}

export type AgentEvent =
  /** Fragmento de texto según llega. La UI lo va concatenando. */
  | { type: "text"; delta: string }
  /** El modelo pidió una tool. `input` es el JSON tal cual lo mandó. */
  | { type: "tool_start"; id: string; name: string; input: unknown }
  /**
   * Resultado de la tool. Lleva `name` aunque el CLI no lo repita en el
   * resultado: el adapter lo recuerda del `tool_start` correspondiente.
   */
  | { type: "tool_end"; id: string; name: string; output: unknown; isError: boolean }
  /** Fin de UN turno. La sesión sigue viva esperando el siguiente. */
  | { type: "turn_end"; costUsd: number; text: string }
  /** Datos de la sesión, llegan una vez al arrancar. */
  | { type: "ready"; sessionId: string; model: string; tools: string[] }
  /** El CLI falló o emitió algo que no supimos leer. Nunca se traga en silencio. */
  | { type: "error"; message: string }

/**
 * Una conversación viva con el agente.
 *
 * Es un proceso persistente, no un spawn por mensaje: así el contexto no se
 * recarga en cada turno (medido: 6.1s el primero, 1.5s el segundo) y se puede
 * responder mientras el agente todavía trabaja.
 */
export interface Session {
  /** Encola un mensaje del usuario. No espera: la respuesta llega por `events`. */
  send(text: string): void
  /** Stream único de eventos de toda la conversación. */
  events(): AsyncIterable<AgentEvent>
  close(): void
}

export interface Engine {
  readonly name: string
  start(opts: StartOpts): Session
}
