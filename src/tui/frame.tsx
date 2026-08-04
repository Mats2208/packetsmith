// Las piezas estructurales de la interfaz: reglas, canaletas y arte.
//
// Viven aparte porque son lo que hace que las tres zonas se lean como un mismo
// aparato. Cuando cada panel dibujaba su propio marco, el resultado eran
// rectángulos anidados —lo que se veía en la v0.2— y no una consola.
//
// La idea de fondo: el marco no se dibuja, se DEDUCE del contraste. Una regla
// de una celda separa mejor que una caja completa, y un fondo apenas distinto
// separa mejor que las dos cosas juntas.
import { For, Show, type JSX } from "solid-js"
import type { BorderCharacters } from "@opentui/core"
import { C } from "./theme.ts"
import type { Run, Tone } from "./ascii.ts"

/** Cada tono del arte, resuelto a color. El arte no sabe de colores. */
export const TONE: Record<Tone, string> = {
  art: C.brand,
  muted: C.fg,
  shadow: C.rule,
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
/** Cuña maciza: el borde de color del campo de escritura. */
export const EDGE = { ...NO_CHARS, vertical: "█" }
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

/**
 * Una fila de instrumentos: segmentos a la izquierda, cola pegada a la derecha.
 *
 * El sobrante va VACÍO. Antes llevaba una textura de código de barras a todo lo
 * ancho y quedaba ruidosa: esa textura no informaba nada, y la regla que sigue
 * este sistema es que el adorno que no dice nada se va. Lo que separa las zonas
 * es el filete y el fondo, no el relleno.
 *
 * Nadie acá sabe cuánto mide la terminal, y no hace falta: el hueco es una caja
 * `flexGrow` que empuja la cola. Medirlo obligaría a un hook de renderer que
 * esta versión de OpenTUI no expone, y a rehacer la cuenta en cada resize. Los
 * segmentos fijos llevan `flexShrink: 0` porque si no el hueco se los come.
 */
export function Hud(props: {
  segments: { text: string; fg?: string }[]
  /** Se dibuja a la izquierda de todo, sin separador. Para el indicador de
   *  actividad, que tiene que estar donde el ojo cae primero. */
  lead?: JSX.Element
  /** Pegado al borde derecho. */
  tail?: JSX.Element
}) {
  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      <Show when={props.lead}>{props.lead}</Show>
      <For each={props.segments}>
        {(s, i) => (
          <>
            <Show when={i() > 0 || props.lead}>
              <text style={{ fg: C.rule, flexShrink: 0 }}>{"  ·  "}</text>
            </Show>
            <text style={{ fg: s.fg ?? C.dim, flexShrink: 0 }}>{s.text}</text>
          </>
        )}
      </For>
      <box style={{ flexGrow: 1 }} />
      <Show when={props.tail}>{props.tail}</Show>
    </box>
  )
}

/**
 * Barra de proporción, en dos tonos.
 *
 * Los dos tonos son el punto. Antes la barra entera iba en un solo color y
 * `█` y `░` quedaban indistinguibles sobre el fondo casi-negro: el medidor
 * dibujaba una mancha del mismo largo pasara lo que pasara. Una barra que no
 * distingue lo lleno de lo vacío no es un medidor, es decoración.
 *
 * Va SIN envoltorio propio para poder ir adentro de un `<text>` junto a su
 * etiqueta y su número, que es donde tiene sentido leerla.
 */
export function Gauge(props: { fraction: number; width?: number; fg?: string }) {
  const width = () => props.width ?? 8
  const filled = () =>
    Math.max(0, Math.min(width(), Math.round((props.fraction || 0) * width())))

  return (
    <>
      <span style={{ fg: props.fg ?? C.wire }}>{"█".repeat(filled())}</span>
      <span style={{ fg: C.rule }}>{"░".repeat(width() - filled())}</span>
    </>
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
