// La paleta de comandos, probada donde se rompe: en el teclado.
//
// El riesgo de este diseño era que el campo de escritura NO pierde el foco
// mientras la lista está abierta. Se apuesta a que un handler global puede
// marcar la tecla como consumida antes de que llegue al textarea. Si eso
// fallara, Enter mandaría el mensaje al agente además de ejecutar el comando, y
// las flechas se moverían por el texto en vez de por la lista.
import { expect, test, describe, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import { dialog, filtrar, hayDialogo, puntaje, ventana, type Opcion } from "../src/tui/picker.tsx"
import { COMMANDS } from "../src/tui/commands.ts"
import { setTheme, theme } from "../src/tui/theme.ts"
import type { AgentEvent, Engine } from "../src/engine/types.ts"

process.env.PACKETSMITH_NO_QUOTA = "1"

/** Un motor que no lanza nada y anota lo que se le manda. */
function motorEspia(enviados: string[]): Engine {
  return {
    name: "claude",
    start: () => ({
      send: (t) => { enviados.push(t); return true },
      async *events(): AsyncIterable<AgentEvent> {
        yield { type: "ready", sessionId: "s-test", model: "claude-sonnet-5", tools: [] }
        await new Promise(() => {})
      },
      close() {},
    }),
  }
}

async function montar(enviados: string[] = []) {
  const setup = await testRender(
    () => App({ engine: motorEspia(enviados), columns: 100, quota: { session: 10 } }),
    { width: 100, height: 30 },
  )
  await new Promise((r) => setTimeout(r, 60))
  return setup
}

const frame = async (s: Awaited<ReturnType<typeof montar>>) => {
  await s.renderOnce()
  return await s.captureCharFrame()
}

afterEach(() => {
  dialog.cerrarTodo()
  setTheme("telemetry")
})

describe("puntaje", () => {
  test("el prefijo le gana a la subcadena y esta a las letras salteadas", () => {
    // Con `/model` y `/move` en la lista, tipear "mo" tiene que ser predecible
    // y no una lotería. Es el caso real que tiene opencode.
    expect(puntaje("/model", "/mod")!).toBeGreaterThan(puntaje("/theme", "hem")!)
    expect(puntaje("/theme", "hem")!).toBeGreaterThan(puntaje("/effort", "eot")!)
  })

  test("lo que no está no matchea", () => {
    expect(puntaje("/model", "zzz")).toBeUndefined()
  })

  test("sin consulta, todo vale lo mismo", () => {
    expect(puntaje("/lo-que-sea", "")).toBe(0)
  })
})

describe("filtrar", () => {
  const ops: Opcion[] = [
    { value: "a", title: "/model", description: "cambiar de modelo" },
    { value: "b", title: "/theme", description: "cambiar la paleta" },
    { value: "c", title: "/exit", description: "salir" },
  ]

  test("sin filtro devuelve todo, en orden", () => {
    expect(filtrar(ops, "").map((o) => o.value)).toEqual(["a", "b", "c"])
  })

  test("el prefijo del título manda", () => {
    expect(filtrar(ops, "the")[0]!.value).toBe("b")
  })

  test("también busca en la descripción", () => {
    // Los comandos están en inglés y quien los usa piensa en castellano.
    expect(filtrar(ops, "paleta").map((o) => o.value)).toContain("b")
  })

  test("lo que no matchea desaparece", () => {
    expect(filtrar(ops, "qqq")).toHaveLength(0)
  })
})

describe("ventana", () => {
  test("una lista corta se muestra entera", () => {
    expect(ventana(4, 0, 10)).toEqual([0, 4])
  })

  test("el cursor no se sale por abajo", () => {
    // Sin esto, bajar más allá de la décima fila movía la selección a un lugar
    // que no estaba dibujado.
    const [desde, hasta] = ventana(30, 25, 10)
    expect(25).toBeGreaterThanOrEqual(desde)
    expect(25).toBeLessThan(hasta)
  })

  test("al final de la lista la ventana se apoya en el borde", () => {
    expect(ventana(30, 29, 10)).toEqual([20, 30])
  })
})

describe("la paleta en pantalla", () => {
  test("`/` en un campo vacío la abre", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    expect(hayDialogo()).toBe(true)
    expect(await frame(s)).toContain("/model")
  })

  test("Ctrl+P la abre aunque haya texto escrito", async () => {
    // Si ya redactaste medio mensaje y querés cambiar de modelo, borrarlo
    // primero sería absurdo.
    const s = await montar()
    await s.mockInput.typeText("una red con tres routers")
    expect(hayDialogo()).toBe(false)
    s.mockInput.pressKey("p", { ctrl: true })
    expect(hayDialogo()).toBe(true)
  })

  test("una `/` en el medio de una frase es una barra y nada más", async () => {
    const s = await montar()
    await s.mockInput.typeText("subred 10.0.0.0/24")
    expect(hayDialogo()).toBe(false)
  })

  test("tipear filtra la lista", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("theme")
    const f = await frame(s)
    expect(f).toContain("/theme")
    expect(f).not.toContain("/export")
  })

  test("Esc cierra sin ejecutar nada", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    s.mockInput.pressEscape()
    await new Promise((r) => setTimeout(r, 40))
    expect(hayDialogo()).toBe(false)
  })
})

describe("el teclado no se le escapa al campo de escritura", () => {
  test("Enter ejecuta el comando y NO le manda nada al agente", async () => {
    // Es EL riesgo del diseño: el textarea conserva el foco, así que si el
    // handler global no consumiera la tecla, Enter haría las dos cosas.
    const enviados: string[] = []
    const s = await montar(enviados)
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("help")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 30))

    expect(enviados).toHaveLength(0)
    expect(hayDialogo()).toBe(false)
    // /help contesta en el chat sin gastar un turno.
    expect(await frame(s)).toContain("comandos")
  })

  test("las flechas mueven la lista, no el cursor del texto", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    const primero = await frame(s)
    s.mockInput.pressArrow("down")
    const segundo = await frame(s)
    expect(segundo).not.toBe(primero)
  })

  test("lo que se tipea con la lista abierta no ensucia el mensaje", async () => {
    // El filtro es del diálogo. Si las teclas llegaran al textarea, al cerrar
    // quedaría "theme" escrito en el campo.
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("theme")
    s.mockInput.pressEscape()
    await new Promise((r) => setTimeout(r, 40))
    expect(await frame(s)).not.toContain("theme")
  })
})

describe("/theme previsualiza y revierte", () => {
  test("moverse por la lista aplica el tema al toque", async () => {
    // Elegir un tema leyendo su nombre es adivinar.
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("theme")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 20))

    const antes = theme().name
    s.mockInput.pressArrow("down")
    expect(theme().name).not.toBe(antes)
  })

  test("salir con Esc devuelve el tema que tenías", async () => {
    const s = await montar()
    const original = theme().name
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("theme")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 20))
    s.mockInput.pressArrow("down")
    s.mockInput.pressEscape()
    await new Promise((r) => setTimeout(r, 40))
    expect(theme().name).toBe(original)
  })
})

describe("comandos", () => {
  test("no hay dos con el mismo nombre ni el mismo título", () => {
    expect(new Set(COMMANDS.map((c) => c.name)).size).toBe(COMMANDS.length)
    expect(new Set(COMMANDS.map((c) => c.title)).size).toBe(COMMANDS.length)
  })

  test("todos empiezan con `/` y tienen descripción", () => {
    for (const c of COMMANDS) {
      expect(c.title.startsWith("/")).toBe(true)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.category.length).toBeGreaterThan(0)
    }
  })

  test("se puede tipear el comando entero sin pasar por la lista", async () => {
    const enviados: string[] = []
    const s = await montar(enviados)
    await s.mockInput.typeText("/debug")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 30))
    expect(enviados).toHaveLength(0)
    expect(await frame(s)).toContain("sesión")
  })
})
