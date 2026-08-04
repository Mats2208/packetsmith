// Arte y texturas ASCII.
//
// Todo lo de acá es puro: strings adentro, strings afuera. Eso permite testear
// el DIBUJO —que es lo que se rompe— sin montar la interfaz, y deja que la capa
// de UI se ocupe solo del color.
//
// Regla que se hereda del arte ASCII bueno: el set de caracteres es acotado a
// propósito. Acá son cuatro familias y nada más —bloques (█▀▄), densidades
// (▓▒░), líneas (─│┌┬) y barras (▏▎▍▌▋)— porque mezclar tipografías de caja
// termina en un collage que no lee como un sistema.

/** Un tramo de texto con su tono. La UI decide qué color es cada tono. */
export type Tone = "art" | "muted" | "shadow"
export interface Run {
  text: string
  tone: Tone
}

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

/**
 * Columna donde termina PACKET y empieza SMITH.
 *
 * El bloqueo tipográfico de la marca es un lockup a dos tonos: la primera
 * palabra apagada, la segunda encendida. Un logo de un solo tono en un panel de
 * un solo tono no es un logo, es un título.
 */
const SPLIT = 27

/**
 * Arma la marca terminada: dos tonos y una fila de reflejo.
 *
 * El reflejo es la última fila del arte repetida en tono sombra. Se probó antes
 * una sombra proyectada abajo-a-la-derecha calculada sobre todo el dibujo, y no
 * sirve con esta tipografía: los half-blocks no dejan huecos internos, así que
 * la sombra rellenaba el aire ENTRE las letras y la palabra se volvía una masa.
 * El reflejo cae fuera del área de las letras, así que no puede arruinarlas.
 */
export function wordmark(): Run[][] {
  const rows: Run[][] = WORDMARK.map((line) => [
    { text: line.slice(0, SPLIT), tone: "muted" as const },
    { text: line.slice(SPLIT), tone: "art" as const },
  ])

  // Cada celda pintada se refleja como media altura: el reflejo queda pegado a
  // la base de las letras, como el fósforo en el vidrio.
  const base = WORDMARK[WORDMARK.length - 1]!
  rows.push([{
    text: [...base].map((ch) => (ch === " " ? " " : "▀")).join(""),
    tone: "shadow",
  }])

  return rows
}

/**
 * La cadena completa, ida y vuelta.
 *
 * El lazo de retorno es la mitad que importa y la que no se explica sola: el
 * panel de topología no lo dibuja PacketSmith de memoria, lo deriva de lo que
 * Packet Tracer devuelve. Un diagrama de tres cajas en fila lo ocultaba.
 */
export const CHAIN = [
  "┌───────┐    ┌────────┐    ┌───────────────┐",
  "│  VOS  │───▶│ AGENTE │───▶│ PACKET TRACER │",
  "└───────┘    └────────┘    └───────┬───────┘",
  "    ▲                              │",
  "    └────────── TOPOLOGÍA ─────────┘",
] as const

/**
 * Esquema genérico para el panel vacío.
 *
 * Un panel en blanco con la palabra "esperando" no dice qué va a aparecer. Este
 * boceto lo dice sin una línea de prosa, y de paso el hueco deja de ser hueco.
 */
export const SCHEMATIC = [
  "      ┌─────┐",
  "      │  ◆  │",
  "      └──┬──┘",
  "   ┌─────┴─────┐",
  "┌──┴──┐     ┌──┴──┐",
  "│  ▣  │     │  ▣  │",
  "└┬───┬┘     └┬───┬┘",
  " ▪   ▪       ▪   ▪",
] as const

/** Barra de progreso en bloques: `████░░░░` sin dependencias. */
export function bar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

const BARCODE = "▏▎▍▌▋"

/**
 * Textura de código de barras para rellenar lo que sobra de una fila.
 *
 * Es determinista a propósito —una tabla de bits, no `Math.random`— así el
 * patrón no titila en cada re-render y los tests pueden afirmar qué sale.
 */
export function barcode(width: number): string {
  let out = ""
  for (let i = 0; i < width; i++) {
    // Knuth: multiplicar por la razón áurea de 32 bits mezcla bits vecinos, que
    // es justo lo que hace falta para que índices seguidos no se parezcan.
    const h = Math.imul(i + 1, 2654435761) >>> 0
    out += (h >>> 9) % 3 === 0 ? " " : BARCODE[(h >>> 4) % BARCODE.length]
  }
  return out
}

const DENSITY = "█▓▒░"

/**
 * Barrido tipo escáner: una cabeza brillante con estela, que va y vuelve.
 *
 * Reemplaza al spinner mientras el agente trabaja. Un spinner de un carácter
 * dice "algo pasa"; un barrido que recorre el ancho del panel dice además
 * cuánto espacio ocupa el sistema, que es la estética que buscamos.
 */
export function sweep(width: number, phase: number): string {
  if (width <= 0) return ""
  // Ida y vuelta en un solo período: si solo fuera de ida, al reiniciar daría
  // un salto seco de la derecha a la izquierda.
  const period = Math.max(1, (width - 1) * 2)
  const t = ((phase % period) + period) % period
  const head = t < width ? t : period - t

  let out = ""
  for (let i = 0; i < width; i++) {
    const d = Math.abs(i - head)
    out += d < DENSITY.length ? DENSITY[d] : "·"
  }
  return out
}

/** `── FABRIC ──────────────` — un título que además separa. */
export function rule(label: string, width: number): string {
  const head = `── ${label.toUpperCase()} `
  return (head + "─".repeat(Math.max(0, width - head.length))).slice(0, width)
}
