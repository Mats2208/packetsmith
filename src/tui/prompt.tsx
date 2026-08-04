// El campo de escritura.
//
// Era un `<input>` de una línea: al pasarse del ancho el texto se iba corriendo
// hacia la izquierda y lo escrito antes desaparecía, así que no se podía releer
// lo que uno mismo estaba pidiendo. Un pedido de red real ocupa dos o tres
// renglones — es el caso normal, no el borde.
//
// Ahora es un `<textarea>`: parte las líneas por palabra, crece hasta tres
// renglones y a partir de ahí scrollea internamente, dejando a la vista el
// final —que es donde está el cursor— sin robarle alto al chat.
import { createSignal } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { C } from "./theme.ts"
import { EDGE } from "./frame.tsx"

/** Hasta acá crece. Más que esto le come el alto a la conversación. */
export const MAX_ROWS = 3

/**
 * Enter manda, Shift+Enter hace salto de línea.
 *
 * OpenTUI trae lo contrario por defecto —Enter es salto y Cmd+Enter manda—, que
 * es lo correcto para un editor y lo inesperado para un chat: la primera vez
 * que probás a mandar un mensaje te comés un renglón vacío.
 *
 * El orden importa: gana la PRIMERA que matchea, y una regla sin `shift` matchea
 * igual con shift apretado. Con `return → submit` arriba, Shift+Enter mandaba
 * el mensaje en vez de saltar de línea.
 *
 * Shift+Enter no alcanza solo: una terminal sin el protocolo de teclado de
 * kitty manda un `\r` pelado y el modificador no viaja, así que ahí Shift+Enter
 * es indistinguible de Enter. Por eso hay dos atajos más para el salto de
 * línea que sí pasan por cualquier terminal: Alt+Enter y Ctrl+J.
 */
const KEYS = [
  { name: "return", shift: true, action: "newline" as const },
  { name: "kpenter", shift: true, action: "newline" as const },
  { name: "return", meta: true, action: "newline" as const },
  { name: "linefeed", action: "newline" as const },
  { name: "return", action: "submit" as const },
  { name: "kpenter", action: "submit" as const },
]

/**
 * Cuántos renglones ocupa el texto una vez partido por palabra.
 *
 * Se calcula acá en vez de preguntárselo al componente: su `virtualLineCount`
 * se actualiza recién en el render SIGUIENTE, así que medirlo cuando cambia el
 * contenido devuelve siempre el valor viejo —y con eso la caja nunca crecía,
 * que era exactamente el bug reportado.
 */
export function visualRows(text: string, width: number): number {
  if (width <= 0) return 1
  let rows = 0

  for (const line of text.split("\n")) {
    let used = 0
    rows += 1
    for (const word of line.split(" ")) {
      // Una palabra más larga que el ancho se parte sola: ocupa lo suyo entero.
      if (word.length > width) {
        rows += Math.ceil((used + word.length) / width) - 1
        used = (used + word.length) % width
        continue
      }
      const next = used ? used + 1 + word.length : word.length
      if (next > width) {
        rows += 1
        used = word.length
      } else {
        used = next
      }
    }
  }
  return Math.max(1, rows)
}

export function Prompt(props: {
  busy: boolean
  placeholder: string
  onSubmit: (text: string) => void
}) {
  const [rows, setRows] = createSignal(1)
  let area: TextareaRenderable | undefined

  const measure = () =>
    setRows(Math.min(MAX_ROWS, visualRows(area?.plainText ?? "", area?.width ?? 0)))

  function submit() {
    const text = area?.plainText.trim() ?? ""
    if (!text || props.busy) return
    // Se limpia ANTES de avisar: en la v0.1 el borrador quedaba con el texto
    // anterior y no se podía escribir un segundo mensaje.
    area?.clear()
    setRows(1)
    props.onSubmit(text)
  }

  return (
    // El campo tiene cuerpo: fondo propio, aire arriba y abajo, y una cuña de
    // color a la izquierda. Antes era una línea suelta pegada al borde inferior
    // y no se leía como "acá se escribe" sino como una fila más de estado.
    //
    // La cuña se apaga mientras el agente trabaja: en ese rato no hay nada que
    // mandar, y que el color desaparezca lo dice sin una palabra.
    <box
      style={{
        flexDirection: "row",
        height: rows() + 2,
        paddingTop: 1,
        paddingBottom: 1,
        paddingRight: 2,
        backgroundColor: C.sunken,
        border: ["left"],
        customBorderChars: EDGE,
        borderColor: props.busy ? C.rule : C.brand,
      }}
    >
      <box style={{ flexGrow: 1, height: rows(), marginLeft: 1 }}>
        <textarea
          ref={(r: TextareaRenderable) => (area = r)}
          focused
          wrapMode="word"
          keyBindings={KEYS}
          placeholder={props.placeholder}
          placeholderColor={C.rule}
          textColor={C.fg}
          backgroundColor={C.sunken}
          focusedBackgroundColor={C.sunken}
          focusedTextColor={C.fg}
          cursorColor={C.brand}
          onContentChange={measure}
          onSubmit={submit}
        />
      </box>
    </box>
  )
}
