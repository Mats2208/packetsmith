// El campo de escritura, tecleado de verdad.
//
// `testRender` expone teclado simulado, así que esto no verifica que el
// componente "se renderiza" sino que ESCRIBIR ahí adentro hace lo que tiene que
// hacer. Es la única forma de atrapar lo que se reportó: el texto corriéndose
// hacia la izquierda en vez de partirse en renglones.
import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { Prompt, MAX_ROWS, visualRows } from "../src/tui/prompt.tsx"

async function promptWith(
  onSubmit: (t: string) => void = () => {},
  width = 40,
  opts: { kittyKeyboard?: boolean } = {},
) {
  const setup = await testRender(
    () => Prompt({ busy: false, placeholder: "describí la red", onSubmit }),
    { width, height: 6, ...opts },
  )
  await setup.renderOnce()
  return setup
}

/** Renglones del cuadro que tienen texto. El campo arranca en la fila 0. */
function usedRows(frame: string): number {
  return frame.split("\n").filter((l) => l.trim()).length
}

describe("visualRows", () => {
  // Se cuenta acá y no se le pregunta al componente: su `virtualLineCount` se
  // actualiza recién en el render SIGUIENTE, así que medirlo al cambiar el
  // contenido devuelve siempre el valor viejo y la caja nunca crecía.
  test("un texto corto ocupa un renglón", () => {
    expect(visualRows("", 20)).toBe(1)
    expect(visualRows("hola", 20)).toBe(1)
  })

  test("parte por palabra, sin cortar la última al medio", () => {
    // 20 de ancho: "crea tres routers" entra justo, "con OSPF" baja.
    expect(visualRows("crea tres routers con OSPF", 20)).toBe(2)
  })

  test("una palabra más larga que el ancho se parte sola", () => {
    expect(visualRows("a".repeat(45), 20)).toBe(3)
  })

  test("los saltos explícitos cuentan como renglón propio", () => {
    expect(visualRows("uno\ndos\ntres", 20)).toBe(3)
    expect(visualRows("uno\n\ntres", 20)).toBe(3)
  })

  test("un ancho todavía sin medir no rompe la cuenta", () => {
    // En el primer render la caja no tiene ancho asignado; devolver 0 o NaN
    // haría un `height` inválido y la fila desaparecería.
    expect(visualRows("hola", 0)).toBe(1)
  })
})

describe("Prompt", () => {
  test("muestra el placeholder cuando está vacío", async () => {
    const setup = await promptWith()
    expect(setup.captureCharFrame()).toContain("describí la red")
  })

  test("el texto largo se parte en renglones en vez de correrse", async () => {
    // El bug reportado: con `<input>` de una línea, pasado el ancho el texto se
    // iba hacia la izquierda y lo escrito antes desaparecía, así que no se
    // podía releer el propio pedido.
    const setup = await promptWith(() => {}, 40)
    await setup.mockInput.typeText("crea tres routers con OSPF y dos switches por cada uno")
    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    expect(frame).toContain("crea tres routers")
    // La prueba de que partió: el final del pedido sigue estando a la vista.
    expect(frame).toContain("cada uno")
    expect(usedRows(frame)).toBeGreaterThan(1)
  })

  test("crece hasta tres renglones y ahí se planta", async () => {
    // Más alto que esto le come a la conversación, que es lo que uno vino a
    // leer. Pasado el tope el campo scrollea por dentro y deja a la vista el
    // final, que es donde está el cursor.
    const setup = await promptWith(() => {}, 30)
    await setup.mockInput.typeText("a".repeat(400))
    await setup.renderOnce()

    expect(usedRows(setup.captureCharFrame())).toBeLessThanOrEqual(MAX_ROWS)
  })

  test("Enter manda y Shift+Enter hace salto de línea", async () => {
    // OpenTUI trae lo contrario por defecto —Enter salta, Cmd+Enter manda—, que
    // es lo correcto para un editor y lo inesperado para un chat.
    const enviados: string[] = []
    const setup = await promptWith((t) => enviados.push(t), 40, { kittyKeyboard: true })

    await setup.mockInput.typeText("primera")
    setup.mockInput.pressEnter({ shift: true })
    await setup.mockInput.typeText("segunda")
    await setup.renderOnce()
    expect(enviados).toHaveLength(0)

    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(enviados).toEqual(["primera\nsegunda"])
  })

  test("Ctrl+J también salta de línea, para terminales sin protocolo kitty", async () => {
    // Sin ese protocolo la terminal manda un `\r` pelado y el Shift no viaja:
    // Shift+Enter se vuelve indistinguible de Enter y mandaría el mensaje a
    // medio escribir. Ctrl+J pasa por cualquier terminal.
    const enviados: string[] = []
    const setup = await promptWith((t) => enviados.push(t))

    await setup.mockInput.typeText("primera")
    setup.mockInput.pressKey("LINEFEED")
    await setup.mockInput.typeText("segunda")
    await setup.renderOnce()
    expect(enviados).toHaveLength(0)

    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(enviados).toEqual(["primera\nsegunda"])
  })

  test("se limpia al mandar", async () => {
    // En la v0.1 el borrador quedaba con el texto anterior y no se podía
    // escribir un segundo mensaje.
    const setup = await promptWith()
    await setup.mockInput.typeText("hola")
    setup.mockInput.pressEnter()
    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("hola")
    expect(frame).toContain("describí la red")
  })

  test("no manda nada en blanco", async () => {
    const enviados: string[] = []
    const setup = await promptWith((t) => enviados.push(t))
    await setup.mockInput.typeText("   ")
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(enviados).toHaveLength(0)
  })
})
