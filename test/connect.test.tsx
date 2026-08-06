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
import { apiKey, clearApiKey, setApiKey } from "../src/auth.ts"
import { PROVIDERS, findProvider } from "../src/engine/providers/catalog.ts"
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

  test("cada uno declara dónde sacar la key y con qué modelo arrancar", () => {
    for (const p of PROVIDERS) {
      expect(p.env.length).toBeGreaterThan(0)
      expect(p.consola).toMatch(/^https:\/\//)
      expect(p.modelos).toContain(p.porDefecto)
      expect(p.baseUrl).toMatch(/^https:\/\//)
    }
  })

  test("no hay ids repetidos", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length)
  })
})

describe("guardar y leer la key", () => {
  test("se guarda y se vuelve a leer", () => {
    const p = ruta()
    expect(setApiKey("kimi", "sk-secreta", p)).toBe(true)
    expect(apiKey("kimi", p)).toBe("sk-secreta")
  })

  test("el entorno GANA sobre el archivo", () => {
    // Es lo que espera cualquiera que exporta una variable para probar algo.
    const p = ruta()
    setApiKey("kimi", "la-del-archivo", p)
    process.env.MOONSHOT_API_KEY = "la-del-entorno"
    try {
      expect(apiKey("kimi", p)).toBe("la-del-entorno")
    } finally {
      delete process.env.MOONSHOT_API_KEY
    }
  })

  test("guardar una no pisa la de otro proveedor", () => {
    const p = ruta()
    setApiKey("kimi", "a", p)
    setApiKey("deepseek", "b", p)
    expect(apiKey("kimi", p)).toBe("a")
    expect(apiKey("deepseek", p)).toBe("b")
  })

  test("se puede desconectar", () => {
    const p = ruta()
    setApiKey("kimi", "a", p)
    expect(clearApiKey("kimi", p)).toBe(true)
    expect(apiKey("kimi", p)).toBeUndefined()
  })

  test("un archivo roto no rompe nada", () => {
    const p = ruta()
    writeFileSync(p, "no soy json")
    expect(apiKey("kimi", p)).toBeUndefined()
  })

  test.skipIf(process.platform === "win32")("el archivo queda solo para el dueño", () => {
    // Una key en un archivo legible por cualquiera es una key filtrada.
    const p = ruta()
    setApiKey("kimi", "sk-secreta", p)
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

  test("elegir uno abre el campo para pegar la key, enmascarado", async () => {
    const s = await montar()
    await s.mockInput.typeText("/")
    await s.mockInput.typeText("connect")
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

  test("cada proveedor del catálogo tiene una consola donde sacar la key", () => {
    // Es lo que se muestra debajo del campo. Sin eso, "pegá tu key" no dice de
    // dónde sacarla.
    for (const p of PROVIDERS) expect(findProvider(p.id)!.consola.length).toBeGreaterThan(10)
  })
})
