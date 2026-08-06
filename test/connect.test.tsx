// `/connect`: poner una API key sin salir de la app.
//
// Antes la única forma era editar `~/.packetsmith/auth.json` a mano, que es
// exactamente lo que esta app existe para no tener que hacer.
import { expect, test, describe, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import { dialog, dialogoActivo, enmascarar } from "../src/tui/picker.tsx"
import { apiKey, clearApiKey, hayCredencial, planElegido, setApiKey, setOauth, setPlan } from "../src/auth.ts"
import { PROVIDERS, findPlan, findProvider, variablesDe } from "../src/engine/providers/catalog.ts"
import { engines } from "../src/engine/index.ts"
import type { AgentEvent, Engine } from "../src/engine/types.ts"

process.env.PACKETSMITH_NO_QUOTA = "1"

const dirs: string[] = []
const ruta = () => {
  const d = mkdtempSync(join(tmpdir(), "packetsmith-auth-"))
  dirs.push(d)
  return join(d, "auth.json")
}
afterEach(() => {
  dialog.cerrarTodo()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("el catálogo de proveedores", () => {
  test("todos son motores de verdad", () => {
    // Si un proveedor está en la tabla pero no en el registro, `/connect` te
    // dejaría poner una key para algo que después no podés elegir.
    for (const p of PROVIDERS) expect(engines[p.id]).toBeDefined()
  })

  test("cada plan declara dónde entrar y con qué modelo arrancar", () => {
    for (const p of PROVIDERS) {
      expect(p.planes.length).toBeGreaterThan(0)
      for (const pl of p.planes) {
        expect(pl.consola).toMatch(/^https:\/\//)
        expect(pl.baseUrl).toMatch(/^https:\/\//)
        // El respaldo tiene que contener el modelo por defecto: si no, sin red
        // arrancás con un modelo que no está en la lista que se te ofrece.
        expect(pl.modelos).toContain(pl.porDefecto)
        // Un plan con key tiene que decir de qué variable sale. El de ChatGPT
        // no tiene key, y por eso es el único que puede no declarar ninguna.
        if (pl.auth !== "chatgpt") expect(pl.env.length).toBeGreaterThan(0)
      }
    }
  })

  test("no hay ids repetidos, ni de proveedor ni de plan", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length)
    for (const p of PROVIDERS) {
      expect(new Set(p.planes.map((x) => x.id)).size).toBe(p.planes.length)
    }
  })

  test("Kimi es UN proveedor con dos planes, no dos proveedores", () => {
    // Kimi Code y la Open Platform son la misma empresa cobrando de dos
    // maneras. Mostrarlos como dos proveedores en `/engine` era el bug.
    const kimi = findProvider("kimi")!
    expect(kimi.planes.map((p) => p.id)).toEqual(["coding", "api"])
    expect(PROVIDERS.some((p) => p.id === "moonshot")).toBe(false)
    // Y son endpoints distintos de verdad: una key de uno da 401 contra el otro.
    expect(kimi.planes[0]!.baseUrl).not.toBe(kimi.planes[1]!.baseUrl)
  })

  test("el plan de ChatGPT no pide una key que no existe", () => {
    const plan = findPlan("openai", "chatgpt")!
    expect(plan.auth).toBe("chatgpt")
    expect(plan.protocolo).toBe("responses")
  })

  test("findPlan cae en el primero, que es el recomendado", () => {
    expect(findPlan("kimi")!.id).toBe("coding")
    expect(findPlan("kimi", "noexiste")!.id).toBe("coding")
    expect(findPlan("kimi", "api")!.id).toBe("api")
  })
})

describe("guardar y leer la key", () => {
  test("se guarda y se vuelve a leer", () => {
    const p = ruta()
    expect(setApiKey("kimi", "sk-secreta", "coding", p)).toBe(true)
    expect(apiKey("kimi", undefined, p)).toBe("sk-secreta")
    expect(planElegido("kimi", p)).toBe("coding")
  })

  test("el entorno GANA sobre el archivo", () => {
    // Es lo que espera cualquiera que exporta una variable para probar algo.
    // La variable sale del catálogo y no está escrita acá a mano: así el test
    // sigue diciendo la verdad cuando un proveedor cambia de nombre de variable.
    const p = ruta()
    const v = variablesDe("kimi").at(-1)!
    setApiKey("kimi", "la-del-archivo", "coding", p)
    process.env[v] = "la-del-entorno"
    try {
      expect(apiKey("kimi", undefined, p)).toBe("la-del-entorno")
    } finally {
      delete process.env[v]
    }
  })

  test("cada PLAN tiene sus propias variables", () => {
    // Dos planes que compartan variable se pisan la key. Kimi Code y la Open
    // Platform son endpoints distintos con keys distintas, y una key de uno
    // contra el otro da 401 — así que no pueden salir de la misma variable.
    // Z.AI es la excepción declarada: los dos planes usan LA MISMA key, solo
    // cambia la puerta.
    const vistas = new Map<string, string>()
    for (const p of PROVIDERS) {
      if (p.id === "zai") continue
      for (const pl of p.planes) {
        for (const v of pl.env) {
          const clave = `${p.id}/${pl.id}`
          expect(vistas.get(v) ?? clave).toBe(clave)
          vistas.set(v, clave)
        }
      }
    }
  })

  test("guardar tokens de un login deja la sesión utilizable", () => {
    const p = ruta()
    expect(setOauth("openai", {
      access: "ac", refresh: "re", expires: Date.now() + 3600_000, accountId: "cuenta",
    }, "chatgpt", p)).toBe(true)
    expect(hayCredencial("openai", p)).toBe(true)
    expect(planElegido("openai", p)).toBe("chatgpt")
    // Una sesión NO es una key: pedirla como key tiene que dar vacío, o el
    // motor mandaría un token de OAuth por el camino de la API por token.
    expect(apiKey("openai", "chatgpt", p)).toBeUndefined()
  })

  test("elegir plan no borra la credencial que ya había", () => {
    const p = ruta()
    setApiKey("zai", "una-key", "api", p)
    setPlan("zai", "coding", p)
    expect(planElegido("zai", p)).toBe("coding")
    expect(apiKey("zai", undefined, p)).toBe("una-key")
  })

  test("guardar una no pisa la de otro proveedor", () => {
    const p = ruta()
    setApiKey("kimi", "a", "coding", p)
    setApiKey("deepseek", "b", "api", p)
    expect(apiKey("kimi", undefined, p)).toBe("a")
    expect(apiKey("deepseek", undefined, p)).toBe("b")
  })

  test("se puede desconectar", () => {
    const p = ruta()
    setApiKey("kimi", "a", "coding", p)
    expect(clearApiKey("kimi", p)).toBe(true)
    expect(apiKey("kimi", undefined, p)).toBeUndefined()
  })

  test("un archivo roto no rompe nada", () => {
    const p = ruta()
    writeFileSync(p, "no soy json")
    expect(apiKey("kimi", undefined, p)).toBeUndefined()
  })

  test.skipIf(process.platform === "win32")("el archivo queda solo para el dueño", () => {
    // Una key en un archivo legible por cualquiera es una key filtrada.
    const p = ruta()
    setApiKey("kimi", "sk-secreta", "coding", p)
    const { statSync } = require("node:fs")
    expect(statSync(p).mode & 0o077).toBe(0)
  })
})

describe("enmascarar", () => {
  test("deja ver los últimos cuatro y nada más", () => {
    // Ocultarla entera deja sin forma de notar que se pegó mal; mostrarla
    // entera la deja en pantalla.
    expect(enmascarar("sk-abcdef1234")).toEndWith("1234")
    expect(enmascarar("sk-abcdef1234")).not.toContain("abcdef")
  })

  test("una key cortita no muestra nada", () => {
    expect(enmascarar("ab")).toBe("••")
  })

  test("una key larguísima no desborda el renglón", () => {
    expect(enmascarar("x".repeat(500)).length).toBeLessThan(32)
  })
})

describe("/connect en pantalla", () => {
  const motor: Engine = {
    name: "claude",
    start: () => ({
      send: () => true,
      async *events(): AsyncIterable<AgentEvent> {
        yield { type: "ready", sessionId: "s", model: "m", tools: [] }
        await new Promise(() => {})
      },
      close() {},
    }),
  }

  async function montar() {
    const s = await testRender(
      () => App({ engine: motor, columns: 100, quota: { session: 5 } }),
      { width: 100, height: 30 },
    )
    await new Promise((r) => setTimeout(r, 60))
    return s
  }
  const frame = async (s: Awaited<ReturnType<typeof montar>>) => {
    await s.renderOnce()
    return await s.captureCharFrame()
  }

  test("lista los proveedores", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    const f = await frame(s)
    expect(f).toContain("kimi")
    expect(f).toContain("deepseek")
  })

  test("elegir proveedor pregunta el PLAN antes de pedir la key", async () => {
    // Son dos preguntas distintas: a quién le hablás y con qué plan. Kimi tiene
    // dos, y antes se ofrecían como dos proveedores.
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))

    const f = await frame(s)
    expect(f).toContain("coding")
    expect(f).toContain("api")
    // Todavía no pide nada secreto: primero hay que saber a qué plan entrar.
    expect(dialogoActivo()?.escribir).toBeUndefined()
  })

  test("elegido el plan, abre el campo para pegar la key, enmascarado", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))

    expect(dialogoActivo()?.escribir).toBeDefined()
    await s.mockInput.typeText("sk-1234567890")
    const f = await frame(s)
    // Se ven los últimos cuatro; el resto son puntos.
    expect(f).toContain("7890")
    expect(f).not.toContain("sk-1234567890")
  })

  test("con la lista de proveedores abierta, escribir filtra y no ensucia el mensaje", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    await s.mockInput.typeText("deep")
    const f = await frame(s)
    expect(f).toContain("deepseek")
    expect(f).not.toContain("openrouter")
  })

  test("una key PEGADA entra en el campo y no en el mensaje", async () => {
    // Una key se pega, no se tipea. El pegado llega como un evento aparte y
    // los oyentes globales corren ANTES que el textarea, así que si el diálogo
    // no lo consume la key entra en los dos lados: en el campo y en el mensaje,
    // a la vista y lista para mandarse al agente sin querer.
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))
    s.mockInput.pressEnter()
    await new Promise((r) => setTimeout(r, 40))

    // Con el salto del final que deja copiar de una web.
    await s.mockInput.pasteBracketedText("sk-pegada-abcd9876\n")
    expect(await frame(s)).toContain("9876")

    // Se sale con Esc como saldría cualquiera: uno por diálogo abierto, hasta
    // que no queda ninguno.
    for (let i = 0; i < 6 && dialogoActivo(); i++) {
      s.mockInput.pressEscape()
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(dialogoActivo()).toBeUndefined()
    const f = await frame(s)
    expect(f).not.toContain("9876")
    expect(f).not.toContain("sk-pegada")
  })

  test("con la paleta abierta el pegado no llega al mensaje", async () => {
    // Mismo motivo, sin campo donde escribir: el diálogo lo consume igual.
    const s = await montar()
    await s.mockInput.typeText("/")
    await new Promise((r) => setTimeout(r, 40))
    await s.mockInput.pasteBracketedText("RASTRO-DEL-PEGADO")
    s.mockInput.pressEscape()
    await new Promise((r) => setTimeout(r, 40))
    expect(await frame(s)).not.toContain("RASTRO-DEL-PEGADO")
  })

  test("cada proveedor del catálogo tiene una consola donde sacar la key", () => {
    // Es lo que se muestra debajo del campo. Sin eso, "pegá tu key" no dice de
    // dónde sacarla.
    for (const p of PROVIDERS) {
      for (const pl of p.planes) expect(pl.consola.length).toBeGreaterThan(10)
    }
  })
})
