// Arte ASCII. Se dibuja una sola vez, al arrancar, y desaparece con el primer
// mensaje: un banner permanente roba las filas que el chat necesita.

/**
 * Wordmark en half-blocks.
 *
 * Se usan ▄ ▀ █ en vez de letras hechas con `#` o `*`: los half-blocks tienen
 * el doble de resolución vertical, así que la marca entra en 3 filas en vez de
 * 6 y se ve dibujada, no tipeada.
 */
export const WORDMARK = [
  "█▀▀█ █▀▀█ █▀▀ █ █ █▀▀ ▀▀█▀▀ █▀▀ █▀▄▀█ █ ▀▀█▀▀ █ █",
  "█▄▄█ █▄▄█ █   █▀▄ █▀▀   █   ▀▀█ █ ▀ █ █   █   █▀█",
  "█    ▀  ▀ ▀▀▀ ▀ ▀ ▀▀▀   ▀   ▀▀▀ ▀   ▀ ▀   ▀   ▀ ▀",
] as const

/** Diagrama de la cadena: dice qué hace la app sin una línea de prosa. */
export const CHAIN = [
  "┌────────┐   ┌─────────┐   ┌──────────────┐",
  "│  vos   │──▶│  agente │──▶│ packet tracer│",
  "└────────┘   └─────────┘   └──────────────┘",
] as const

/** Barra de progreso en bloques: `████░░░░` sin dependencias. */
export function bar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/** Puntos de actividad que rotan con cada evento — un spinner sin timers. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
