// Contrato común a todos los motores. Un adapter traduce lo que emite SU CLI a
// este union; de ahí para arriba nadie sabe si corre claude, codex u opencode.

/** Lo que le pedimos al motor. */
export interface RunOpts {
  prompt: string
  /** Sesión previa a continuar. Sin esto, cada turno empieza de cero. */
  sessionId?: string
  model?: string
  /** Lista blanca de tools. `undefined` = las que el CLI traiga por defecto. */
  allowedTools?: string[]
  cwd?: string
  /** Para cortar el proceso desde la UI (Esc, salir). */
  signal?: AbortSignal
}

export type AgentEvent =
  /** Fragmento de texto según llega. La UI lo va concatenando. */
  | { type: "text"; delta: string }
  /** El modelo pidió una tool. `input` es el JSON tal cual lo mandó. */
  | { type: "tool_start"; id: string; name: string; input: unknown }
  /**
   * Resultado de la tool. Lleva `name` aunque el CLI no lo repita en el
   * resultado: el adapter lo recuerda del `tool_start` correspondiente.
   * Sin eso, el panel de topología no sabría si un resultado es de
   * `pt_export_topology` o de un `Read` cualquiera.
   */
  | { type: "tool_end"; id: string; name: string; output: unknown; isError: boolean }
  /** Fin del turno. `text` es la respuesta completa, ya reensamblada. */
  | { type: "done"; sessionId: string; costUsd: number; text: string }
  /** El CLI falló o emitió algo que no supimos leer. Nunca se traga en silencio. */
  | { type: "error"; message: string }

export interface Engine {
  readonly name: string
  /**
   * Emite MIENTRAS el agente trabaja. Tiene que ser AsyncIterable y no una
   * promesa del resultado final: si un adapter colecta todo y devuelve al
   * cierre, el panel derecho no puede reaccionar a nada, que es la feature.
   */
  run(opts: RunOpts): AsyncIterable<AgentEvent>
}
