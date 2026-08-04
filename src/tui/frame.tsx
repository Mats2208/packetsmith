// Las piezas estructurales de la interfaz: reglas, canaletas y arte.
//
// Viven aparte porque son lo que hace que las tres zonas se lean como un mismo
// aparato. Cuando cada panel dibujaba su propio marco, el resultado eran
// rectángulos anidados —lo que se veía en la v0.2— y no una consola.
//
// La idea de fondo: el marco no se dibuja, se DEDUCE del contraste. Una regla
// de una celda separa mejor que una caja completa, y un fondo apenas distinto
// separa mejor que las dos cosas juntas.
import { For, Show } from "solid-js"
import type { BorderCharacters } from "@opentui/core"
import { C } from "./theme.ts"
import type { Run, Tone } from "./ascii.ts"
import { barcode } from "./ascii.ts"

/** Cada tono del arte, resuelto a color. El arte no sabe de colores. */
export const TONE: Record<Tone, string> = {
  art: C.fg,
  muted: C.dim,
  shadow: C.shadow,
}

/**
 * Bordes que dibujan UN solo trazo.
 *
 * OpenTUI exige el juego completo de caracteres aunque se pida un solo lado,
 * así que el resto va vacío. Combinado con `border={["left"]}` da una canaleta
 * vertical sin esquinas ni cierre — el separador de toda la vida, no una caja.
 */
const NO_CHARS: BorderCharacters = {
  topLeft: "", topRight: "", bottomLeft: "", bottomRight: "",
  horizontal: "", vertical: "", topT: "", bottomT: "",
  leftT: "", rightT: "", cross: "",
}

/** Canaleta vertical gruesa: divide el chat de la telemetría. */
export const SPLIT = { ...NO_CHARS, vertical: "┃" }
/** Canaleta fina: marca de quién es un mensaje, a lo largo de todo el bloque. */
export const GUTTER = { ...NO_CHARS, vertical: "▌" }
/** Regla horizontal a lo ancho del contenedor, sin tener que saber el ancho. */
export const HAIRLINE = { ...NO_CHARS, horizontal: "─" }

/**
 * Dibuja arte multilínea con sus tonos.
 *
 * Tres cosas son obligatorias acá y las tres se descubrieron rompiéndose:
 *
 *   · cada fila va en `flexDirection: "row"` — varios `<text>` hermanos sin eso
 *     se pintan sobre la MISMA fila (el wordmark de 3 líneas colapsaba a 1);
 *   · cada fila declara `height: 1`;
 *   · el contenedor declara su alto TOTAL. Sin esto mide una fila de menos y el
 *     bloque siguiente le pisa la última: el reflejo del wordmark terminaba
 *     dibujado encima del diagrama de la cadena.
 *
 * Por lo mismo el margen superior es una PROP y no una caja que envuelva: una
 * caja intermedia sin alto declarado vuelve a colapsar y arrastra el problema.
 */
export function Art(props: { rows: Run[][]; marginTop?: number }) {
  return (
    <box
      style={{
        flexDirection: "column",
        height: props.rows.length,
        marginTop: props.marginTop,
        flexShrink: 0,
      }}
    >
      <For each={props.rows}>
        {(row) => (
          <box style={{ flexDirection: "row", height: 1 }}>
            <For each={row}>
              {(run) => <text style={{ fg: TONE[run.tone] }}>{run.text}</text>}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

/** Arte de un solo tono, que es el caso más común. */
export function Plate(props: { lines: readonly string[]; fg?: string; marginTop?: number }) {
  return (
    <box
      style={{
        flexDirection: "column",
        height: props.lines.length,
        marginTop: props.marginTop,
        flexShrink: 0,
      }}
    >
      <For each={props.lines}>
        {(line) => (
          <box style={{ height: 1 }}>
            <text style={{ fg: props.fg ?? C.rule }}>{line}</text>
          </box>
        )}
      </For>
    </box>
  )
}

/** Bastante código de barras como para desbordar cualquier terminal. */
const FILLER = barcode(400)

/**
 * Una fila de instrumentos: segmentos separados por `▏`, el sobrante relleno con
 * textura de código de barras, y una cola pegada al borde derecho.
 *
 * El relleno no es decoración gratuita: sin él la fila termina a mitad de camino
 * y deja de leerse como un instrumento que ocupa todo el ancho.
 *
 * Nadie acá sabe cuánto mide la terminal, y no hace falta: el relleno va en una
 * caja `flexGrow` que RECORTA lo que sobra. Medir el ancho obligaría a un hook
 * de renderer que esta versión de OpenTUI no expone, y a rehacer la cuenta en
 * cada resize. Los segmentos fijos llevan `flexShrink: 0` porque si no el
 * relleno se los come a ellos primero.
 */
export function Hud(props: {
  segments: { text: string; fg?: string }[]
  tail?: { text: string; fg?: string }
  /** Corre el patrón del relleno. Dos HUD con el MISMO código de barras leen
   *  como un error de dibujo; corridos, como dos instrumentos distintos. */
  phase?: number
}) {
  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      <For each={props.segments}>
        {(s, i) => (
          <>
            <Show when={i() > 0}>
              <text style={{ fg: C.rule, flexShrink: 0 }}>{" ▏ "}</text>
            </Show>
            <text style={{ fg: s.fg ?? C.dim, flexShrink: 0 }}>{s.text}</text>
          </>
        )}
      </For>
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text style={{ fg: C.rule }}>{FILLER.slice(props.phase ?? 0)}</text>
      </box>
      <Show when={props.tail}>
        <text style={{ fg: props.tail!.fg ?? C.dim, flexShrink: 0 }}>{props.tail!.text}</text>
      </Show>
    </box>
  )
}

/** Regla horizontal a lo ancho del contenedor. Una celda de alto, sin caja. */
export function Hairline() {
  return (
    <box
      style={{
        height: 1,
        border: ["bottom"],
        borderColor: C.rule,
        customBorderChars: HAIRLINE,
      }}
    />
  )
}
