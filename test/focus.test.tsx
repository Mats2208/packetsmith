// El campo de escritura no se pierde el foco por hacer click en otro lado.
//
// Bug real y de los que arruinan la primera impresión: un `scrollbox` es
// focusable por defecto, así que tocar el panel de topología —o la conversación,
// una vez que tiene contenido— se llevaba el foco, y a partir de ahí tipear no
// hacía absolutamente nada. Ni un mensaje de error: la app simplemente dejaba de
// responder al teclado.
import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import { dialog } from "../src/tui/picker.tsx"
import type { AgentEvent, Engine, Session } from "../src/engine/types.ts"

process.env.PACKETSMITH_NO_QUOTA = "1"

/** Motor con una conversación ya empezada, para que el scrollbox del chat exista. */
function motor(enviados: string[], conTurno: boolean): Engine {
  return {
    name: "claude",
    start: (): Session => ({
      send: (t) => { enviados.push(t); return true },
      async *events(): AsyncIterable<AgentEvent> {
        yield { type: "ready", sessionId: "s1", model: "m", tools: [] }
        if (conTurno) {
          yield { type: "turn_end", costUsd: 0, text: "una respuesta cualquiera\n".repeat(20) }
        }
        await new Promise(() => {})
      },
      close() {},
    }),
  }
}

async function montar(conTurno = false) {
  const enviados: string[] = []
  const s = await testRender(
    () => App({ engine: motor(enviados, conTurno), columns: 100, quota: { session: 5 } }),
    { width: 100, height: 30 },
  )
  await new Promise((r) => setTimeout(r, 80))
  return { s, enviados }
}

const enfocado = (s: Awaited<ReturnType<typeof montar>>["s"]) =>
  s.renderer.currentFocusedRenderable?.constructor.name ?? "(ninguno)"

describe("el foco se queda donde se escribe", () => {
  test("arranca en el campo de escritura", async () => {
    const { s } = await montar()
    expect(enfocado(s)).toBe("TextareaRenderable")
  })

  test("un click en el panel de topología no se lo lleva", async () => {
    const { s } = await montar()
    await s.mockMouse.click(85, 12)
    await new Promise((r) => setTimeout(r, 30))
    expect(enfocado(s)).toBe("TextareaRenderable")
  })

  test("un click en la conversación tampoco", async () => {
    // Con turnos, el chat deja de ser la portada y pasa a ser un scrollbox.
    const { s } = await montar(true)
    await s.mockMouse.click(25, 10)
    await new Promise((r) => setTimeout(r, 30))
    expect(enfocado(s)).toBe("TextareaRenderable")
  })

  test("después de tocar por ahí se puede seguir escribiendo", async () => {
    // Es la prueba que importa: el foco es un medio, poder escribir es el fin.
    const { s, enviados } = await montar(true)
    await s.mockMouse.click(85, 14)
    await s.mockMouse.click(25, 8)
    await new Promise((r) => setTimeout(r, 30))

    await s.mockInput.typeText("tres routers con OSPF")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    expect(enviados).toEqual(["tres routers con OSPF"])
  })

  test("y la paleta sigue abriéndose con `/`", async () => {
    // Un arreglo de foco que rompiera el teclado global sería peor que el bug.
    const { s } = await montar(true)
    await s.mockMouse.click(85, 14)
    await new Promise((r) => setTimeout(r, 30))
    await s.mockInput.typeText("/")
    await s.renderOnce()
    expect(await s.captureCharFrame()).toContain("/model")
    dialog.cerrarTodo()
  })
})
