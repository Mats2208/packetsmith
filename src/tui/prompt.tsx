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
  /**
   * Entrega una forma de leer el borrador EN EL MOMENTO.
   *
   * La necesita la paleta de comandos: `/` solo abre la lista si el campo está
   * vacío, porque en el medio de una frase una barra es una barra. Y tiene que
   * ser una lectura sincrónica, no una señal que se actualice después: medido,
   * `onContentChange` se dispara una vez terminado el lote de entrada y siempre
   * con el texto final, así que una señal alimentada desde ahí llega tarde
   * justo cuando hay que decidir.
   */
  onReady?: (leerBorrador: () => string) => void
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
    // Un cursor y el texto. Nada más.
    //
    // Antes esto era una caja con fondo propio y una cuña maciza de color a la
    // izquierda, que es la forma que tiene medio agente de terminal. Una barra
    // de una columna encendida a lo alto del campo pesa mucho para lo único que
    // dice —si se puede escribir o no—, y eso lo dice igual un carácter.
    //
    // Así que el estado vive en el prompt: encendido cuando es tu turno,
    // apagado mientras el agente trabaja. Misma información, una fracción de la
    // tinta, y el fondo sin cortar deja que el filete de arriba haga la
    // separación él solo.
    <box style={{ flexDirection: "row", height: rows() + 2, paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ width: 3, height: rows(), flexShrink: 0 }}>
        <text style={{ fg: props.busy ? C.faint : C.brand }}>{" › "}</text>
      </box>
      <box style={{ flexGrow: 1, height: rows(), paddingRight: 2 }}>
        <textarea
          ref={(r: TextareaRenderable) => {
            area = r
            props.onReady?.(() => area?.plainText ?? "")
          }}
          focused
          wrapMode="word"
          keyBindings={KEYS}
          placeholder={props.placeholder}
          placeholderColor={C.faint}
          textColor={C.fg}
          focusedTextColor={C.fg}
          cursorColor={C.brand}
          onContentChange={measure}
          onSubmit={submit}
        />
      </box>
    </box>
  )
}
