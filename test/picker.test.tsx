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
import { dialog, filtrar, hayDialogo, listado, puntaje, VENTANA, type Opcion } from "../src/tui/picker.tsx"
import { COMMANDS, textoDe } from "../src/tui/commands.ts"
import { setTheme, theme } from "../src/tui/theme.ts"
import { LANGS, setIdioma, T } from "../src/tui/i18n.ts"
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

describe("la lista", () => {
  const op = (title: string, category: string): Opcion => ({ value: title, title, category })
  const CINCO = [
    op("/model", "agente"), op("/effort", "agente"), op("/engine", "agente"),
    op("/theme", "apariencia"),
    op("/help", "utilidad"),
  ]

  test("una fila por opción, con encabezado donde cambia la familia", () => {
    const l = listado(CINCO, 0)
    expect(l).toEqual([
      { tipo: "familia", texto: "agente" },
      { tipo: "opcion", i: 0 }, { tipo: "opcion", i: 1 }, { tipo: "opcion", i: 2 },
      { tipo: "familia", texto: "apariencia" },
      { tipo: "opcion", i: 3 },
      { tipo: "familia", texto: "utilidad" },
      { tipo: "opcion", i: 4 },
    ])
  })

  test("sin familias no hay encabezados que gasten filas", () => {
    // Los diálogos de tema, modelo y esfuerzo no tienen familias.
    const temas = [{ value: "ice", title: "ice" }, { value: "nord", title: "nord" }]
    expect(listado(temas, 0)).toEqual([{ tipo: "opcion", i: 0 }, { tipo: "opcion", i: 1 }])
  })

  test("los índices cubren la lista entera, sin huecos ni repetidos", () => {
    // El cursor es UNO solo sobre la lista filtrada; si los índices no la
    // cubrieran exactamente, moverse saltearía comandos.
    const idx = listado(CINCO, 0).filter((e) => e.tipo === "opcion").map((e: any) => e.i)
    expect(idx).toEqual([0, 1, 2, 3, 4])
  })

  test("una lista larga se recorta a la ventana", () => {
    const muchas = Array.from({ length: 40 }, (_, i) => ({ value: `m${i}`, title: `m${i}` }))
    expect(listado(muchas, 0)).toHaveLength(VENTANA)
  })

  test("el cursor SIEMPRE queda dentro de la ventana", () => {
    // Es lo que se rompe sin que se note: con un desplazamiento mal calculado
    // la selección se va fuera de la vista y la lista parece trabada.
    const muchas = Array.from({ length: 40 }, (_, i) => ({ value: `m${i}`, title: `m${i}` }))
    for (const c of [0, 1, 7, 8, 20, 38, 39]) {
      const l = listado(muchas, c)
      expect(l.some((e) => e.tipo === "opcion" && e.i === c)).toBe(true)
    }
  })

  test("al final de una lista larga la ventana no se pasa del borde", () => {
    const muchas = Array.from({ length: 40 }, (_, i) => ({ value: `m${i}`, title: `m${i}` }))
    const l = listado(muchas, 39)
    expect(l).toHaveLength(VENTANA)
    expect((l.at(-1) as { i: number }).i).toBe(39)
  })

  test("no se corta dejando un encabezado huérfano arriba", () => {
    // Un encabezado en la primera fila cuya familia se cortó abajo no dice de
    // qué grupo es lo que estás mirando.
    const largas = [
      ...Array.from({ length: 6 }, (_, i) => op(`/a${i}`, "agente")),
      ...Array.from({ length: 6 }, (_, i) => op(`/b${i}`, "apariencia")),
    ]
    const l = listado(largas, 7)
    expect(l.at(-1)!.tipo).not.toBe("familia")
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
    // /help contesta en el chat sin gastar un turno, listando los comandos.
    expect(await frame(s)).toContain("/model")
  })

  test("las flechas mueven el tablero, no el cursor del texto", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    const primero = await frame(s)
    s.mockInput.pressArrow("right")
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
    s.mockInput.pressArrow("right")
    expect(theme().name).not.toBe(antes)
  })

  test("salir con Esc devuelve el tema que tenías", async () => {
    const s = await montar()
    const original = theme().name
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("theme")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 20))
    s.mockInput.pressArrow("right")
    s.mockInput.pressEscape()
    await new Promise((r) => setTimeout(r, 40))
    expect(theme().name).toBe(original)
  })
})

describe("comandos", () => {
  test("no hay dos con el mismo id ni el mismo `/nombre`", () => {
    expect(new Set(COMMANDS.map((c) => c.name)).size).toBe(COMMANDS.length)
    expect(new Set(COMMANDS.map((c) => textoDe(c).title)).size).toBe(COMMANDS.length)
  })

  test("todos tienen texto en LOS DOS idiomas", () => {
    // El diccionario se llena a mano, así que un comando nuevo puede quedar sin
    // traducir y salir en pantalla con su id crudo (`app.export`) en vez de con
    // su nombre. Este test es la red que lo atrapa.
    for (const lang of LANGS) {
      setIdioma(lang)
      for (const c of COMMANDS) {
        const t = textoDe(c)
        expect(t.title.startsWith("/")).toBe(true)
        expect(t.desc.length).toBeGreaterThan(0)
        expect(T.cat[c.category].length).toBeGreaterThan(0)
      }
    }
    setIdioma("en")
  })

  test("se puede tipear el comando entero sin pasar por la lista", async () => {
    const enviados: string[] = []
    const s = await montar(enviados)
    await s.mockInput.typeText("/debug")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 30))
    expect(enviados).toHaveLength(0)
    expect(await frame(s)).toContain("session")
  })
})
