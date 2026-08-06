// Contrato común a todos los motores. Un adapter traduce lo que emite SU CLI a
// este union; de ahí para arriba nadie sabe si corre claude, codex u opencode.

export interface StartOpts {
  model?: string
  /** Lista blanca de tools. `undefined` = las que el CLI traiga por defecto. */
  allowedTools?: string[]
  cwd?: string
}

/**
 * En qué anda el agente ahora mismo.
 *
 * No se deduce: el CLI lo dice, y hasta ahora lo tirábamos. Sin esto la única
 * señal de vida era que apareciera texto, así que los tramos de razonamiento
 * —que en un modelo con thinking son la mayor parte de la espera— se veían
 * exactamente igual que estar colgado.
 */
export type Phase =
  /** Nadie trabaja: el turno cerró. */
  | "idle"
  /** Pedido en vuelo, todavía no llegó el primer token. */
  | "requesting"
  /** Razonando. Trae los tokens estimados en `thinking`. */
  | "thinking"
  /** Escribiendo la respuesta. */
  | "writing"
  /** Corriendo una tool; `detail` trae cuál. */
  | "tool"

/** Cuánto del contexto va ocupado. Sale del `result` al cerrar el turno. */
export interface Usage {
  tokens: number
  contextWindow: number
}

/** Ventana de cuota del plan. La reporta el CLI sin que haya que pedirla. */
export interface Limits {
  /** `five_hour`, `seven_day`. */
  window: string
  /** `allowed`, `allowed_warning`, `rejected`. */
  status: string
  /** Epoch en segundos. */
  resetsAt: number
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
  | { type: "turn_end"; costUsd: number; text: string; usage?: Usage }
  /** Datos de la sesión, llegan una vez al arrancar. */
  | { type: "ready"; sessionId: string; model: string; tools: string[] }
  /** Cambió lo que el agente está haciendo. */
  | { type: "phase"; phase: Phase; detail?: string }
  /** Tokens de razonamiento acumulados en el tramo en curso. */
  | { type: "thinking"; tokens: number }
  /** Estado de la cuota del plan. */
  | { type: "limits"; limits: Limits }
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
  /**
   * Encola un mensaje del usuario. No espera: la respuesta llega por `events`.
   *
   * Devuelve `false` si la sesión ya no acepta mensajes porque el CLI murió.
   * Escribir en el stdin de un proceso muerto NO tira —se probó—, así que sin
   * este valor de retorno el mensaje se perdía en silencio: la UI lo mostraba
   * como enviado, se ponía a esperar una respuesta que no iba a llegar nunca, y
   * quedaba tildada con el campo de escritura bloqueado.
   */
  send(text: string): boolean
  /** Stream único de eventos de toda la conversación. */
  events(): AsyncIterable<AgentEvent>
  close(): void
}

export interface Engine {
  readonly name: string
  start(opts: StartOpts): Session
}
