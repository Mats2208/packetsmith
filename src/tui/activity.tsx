// En qué anda el agente, ahora mismo.
//
// Antes la única señal de vida era que apareciera texto. Con un modelo que
// razona, la mayor parte de la espera transcurre ANTES de la primera letra, así
// que "pensando treinta segundos" y "colgado" se veían exactamente igual.
//
// El dato no se deduce: el CLI lo dice —`system/status`, bloques `thinking`,
// `thinking_tokens`— y hasta ahora lo tirábamos.
import { Show } from "solid-js"
import type { Phase } from "../engine/types.ts"
import { C } from "./theme.ts"
import { sweep } from "./ascii.ts"

/**
 * Cuartos de círculo girando.
 *
 * Se probó braille (⠋⠙⠹) y no pega con el resto: el aparato está hecho de
 * bloques y filetes, y los puntos meten una tipografía que no es de la casa.
 */
const TURN = ["◐", "◓", "◑", "◒"] as const

/** Etiqueta y color por fase. En reposo se apaga: nada que mirar, nada que gritar. */
const LABEL: Record<Phase, string> = {
  idle: "LISTO",
  requesting: "CONSULTANDO",
  thinking: "RAZONANDO",
  writing: "ESCRIBIENDO",
  tool: "EJECUTANDO",
}

/** `1234` → `1.2k`. Los tokens de razonamiento llegan a decenas de miles. */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** `73` → `1m13s`. Un contador en segundos crudos deja de leerse pasado el minuto. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

export function Activity(props: {
  phase: Phase
  /** Qué tool corre, cuando la fase es `tool`. */
  detail?: string
  /** Tokens de razonamiento del tramo en curso. */
  thinking?: number
  /** Cuánto lleva el turno. */
  elapsedMs?: number
  /** Avanza con un reloj, no con los eventos: el tramo que importa es el
   *  silencioso, y ahí no llega ningún evento que pueda mover un contador. */
  beat: number
}) {
  const busy = () => props.phase !== "idle"
  const glyph = () => (busy() ? TURN[props.beat % TURN.length]! : "○")

  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      <text style={{ fg: busy() ? C.fg : C.faint, flexShrink: 0 }}>
        {`${glyph()} ${props.phase === "tool" && props.detail ? props.detail : LABEL[props.phase]}`}
      </text>
      {/* Los tokens de razonamiento son la prueba de que algo pasa cuando no
          hay texto todavía. Sin ellos "RAZONANDO" también podría estar mintiendo. */}
      <Show when={props.phase === "thinking" && props.thinking}>
        <text style={{ fg: C.dim, flexShrink: 0 }}>{`  ${compact(props.thinking!)} tok`}</text>
      </Show>
      {/* `requesting` es el único tramo sin NINGÚN dato que mostrar: el pedido
          está en vuelo y no volvió ni un token. El barrido ocupa ese hueco con
          movimiento, que es la única información que hay para dar. */}
      <Show when={props.phase === "requesting"}>
        <text style={{ fg: C.faint, flexShrink: 0 }}>{`  ${sweep(12, props.beat)}`}</text>
      </Show>
      <Show when={busy() && props.elapsedMs}>
        <text style={{ fg: C.dim, flexShrink: 0 }}>{`  ${clock(props.elapsedMs!)}`}</text>
      </Show>
    </box>
  )
}
