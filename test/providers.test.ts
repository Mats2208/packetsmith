// El catálogo de planes, models.dev y los medidores de consumo.
//
// Todo lo de acá es puro o se puede aislar con un `fetch` de mentira, así que se
// prueba sin red y sin gastar un token. Lo que NO se prueba acá está dicho al
// final del archivo, para que no parezca cubierto.
import { expect, test, describe, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { traducir } from "../src/engine/providers/openai-responses.ts"
import { etiquetaDeVentana, usoDeepSeek, usoKimiCode, usoOpenRouter } from "../src/engine/providers/usage.ts"
import type { Mensaje } from "../src/engine/providers/openai-compat.ts"

const call = (id: string, name: string, args = "{}") => ({
  id, type: "function" as const, function: { name, arguments: args },
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** Un `fetch` que siempre contesta lo mismo. Para los medidores. */
function fingirFetch(status: number, cuerpo: unknown) {
  const falso = async () => new Response(JSON.stringify(cuerpo), {
    status, headers: { "content-type": "application/json" },
  })
  globalThis.fetch = falso as unknown as typeof fetch
}

describe("protocolo Responses", () => {
  test("el system va a `instructions` y no a la lista de ítems", () => {
    const { instructions, input } = traducir([
      { role: "system", content: "sos un ingeniero de redes" },
      { role: "user", content: "hola" },
    ])
    expect(instructions).toBe("sos un ingeniero de redes")
    expect(input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hola" }] },
    ])
  })

  test("los resultados de tools son ítems SUELTOS, no un mensaje agrupado", () => {
    // Es la diferencia con Anthropic, donde van todos en un mismo mensaje de
    // usuario. Confundirlos es un 400 en la segunda vuelta.
    const { input } = traducir([
      { role: "user", content: "armá la red" },
      { role: "assistant", content: "", tool_calls: [call("t1", "a"), call("t2", "b")] },
      { role: "tool", tool_call_id: "t1", content: "ok A" },
      { role: "tool", tool_call_id: "t2", content: "ok B" },
    ])
    expect(input.slice(-2)).toEqual([
      { type: "function_call_output", call_id: "t1", output: "ok A" },
      { type: "function_call_output", call_id: "t2", output: "ok B" },
    ])
  })

  test("una tool_call se aplana a `function_call` con su call_id", () => {
    const { input } = traducir([
      { role: "assistant", content: "voy", tool_calls: [call("t1", "pt_add_device", '{"model":"2911"}')] },
    ])
    expect(input).toEqual([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "voy" }] },
      { type: "function_call", call_id: "t1", name: "pt_add_device", arguments: '{"model":"2911"}' },
    ])
  })

  test("los ítems crudos vuelven intactos, que es lo que pide `store: false`", () => {
    // Con la conversación sin guardar en el servidor, el razonamiento cifrado
    // lo tenemos que devolver nosotros. Reconstruirlo lo perdería.
    const items = [
      { type: "reasoning", id: "rs_1", encrypted_content: "gAAAAA…" },
      { type: "function_call", call_id: "t1", name: "pt_list_devices", arguments: "{}" },
    ]
    const { input } = traducir([
      { role: "user", content: "listá" },
      { role: "assistant", content: "", tool_calls: [call("t1", "pt_list_devices")], bloques: items },
    ])
    expect(input[1]).toBe(items[0])
    expect(input[2]).toBe(items[1])
  })
})

describe("etiquetaDeVentana", () => {
  test("traduce la duración que informa el proveedor", () => {
    // Kimi informa 300 minutos. Escribir `5H` a mano sería asumirlo.
    expect(etiquetaDeVentana(300, "TIME_UNIT_MINUTE")).toBe("5H")
    expect(etiquetaDeVentana(7, "TIME_UNIT_DAY")).toBe("7D")
    expect(etiquetaDeVentana(1, "TIME_UNIT_HOUR")).toBe("1H")
    expect(etiquetaDeVentana(90, "TIME_UNIT_MINUTE")).toBe("90M")
  })

  test("una unidad desconocida no inventa una etiqueta", () => {
    expect(etiquetaDeVentana(5, "TIME_UNIT_LUNAR")).toBeUndefined()
  })
})

describe("medidores", () => {
  test("Kimi Code: la respuesta real se vuelve porcentajes", async () => {
    // Este cuerpo es el que devolvió la API de verdad, recortado.
    fingirFetch(200, {
      usage: { limit: "100", used: "23", remaining: "77", resetTime: "2026-08-10T16:43:53.762560Z" },
      limits: [{
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { limit: "100", used: "13", resetTime: "2026-08-06T16:43:53.762560Z" },
      }],
      parallel: { limit: "10" },
    })
    const m = await usoKimiCode({ token: "x" })
    expect(m).toMatchObject({ ventana: "5H", sesion: 13, semanal: 23 })
    expect(m!.nota).toContain("10")
    // Los números vienen como TEXTO en esa API. Tratarlos como números sin
    // convertir daba NaN y una barra vacía que parecía "no consumiste nada".
    expect(typeof m!.sesion).toBe("number")
  })

  test("un medidor que no contesta se apaga en vez de romper", async () => {
    fingirFetch(500, { error: "boom" })
    expect(await usoKimiCode({ token: "x" })).toBeUndefined()
  })

  test("un cuerpo inesperado tampoco rompe", async () => {
    fingirFetch(200, { cualquier: "cosa" })
    const m = await usoKimiCode({ token: "x" })
    // Contesta, pero sin números inventados.
    expect(m?.sesion).toBeUndefined()
    expect(m?.semanal).toBeUndefined()
  })

  test("OpenRouter informa saldo, no ventanas", async () => {
    // Una barra de "cuánto del total histórico gastaste" no dice nada útil, así
    // que va como nota y no como porcentaje.
    fingirFetch(200, { data: { total_credits: 25, total_usage: 4.5 } })
    const m = await usoOpenRouter({ token: "x" })
    expect(m!.nota).toBe("saldo $20.50 de $25.00")
    expect(m!.sesion).toBeUndefined()
  })

  test("DeepSeek avisa cuando la cuenta se quedó sin crédito", async () => {
    fingirFetch(200, {
      is_available: false,
      balance_infos: [{ currency: "USD", total_balance: "0.00" }],
    })
    expect((await usoDeepSeek({ token: "x" }))!.nota).toContain("sin crédito")
  })
})

describe("models.dev", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    delete process.env.PACKETSMITH_MODELS_PATH
  })

  function conCatalogo(datos: unknown) {
    const d = mkdtempSync(join(tmpdir(), "packetsmith-models-"))
    dirs.push(d)
    const f = join(d, "models.json")
    writeFileSync(f, JSON.stringify(datos))
    process.env.PACKETSMITH_MODELS_PATH = f
    return f
  }

  test("se queda con los que llaman tools, y ordena lo nuevo primero", async () => {
    conCatalogo({
      demo: {
        models: {
          viejo: { id: "viejo", name: "Viejo", tool_call: true, release_date: "2024-01-01",
                   limit: { context: 128000 }, cost: { input: 1, output: 2 } },
          nuevo: { id: "nuevo", name: "Nuevo", tool_call: true, release_date: "2026-06-01",
                   limit: { context: 1000000 }, reasoning: true },
          // Sin tool calling no puede manejar Packet Tracer: ofrecerlo sería
          // ofrecer algo que falla en la primera vuelta.
          mudo: { id: "mudo", name: "Mudo", tool_call: false, release_date: "2026-07-01" },
        },
      },
    })
    // Import fresco: el módulo cachea la copia en memoria a propósito.
    const { modelosDe, infoDeModelo } = await import(`../src/engine/providers/models-dev.ts?${Math.random()}`)
    const m = modelosDe("demo")
    expect(m.map((x: { id: string }) => x.id)).toEqual(["nuevo", "viejo"])
    expect(infoDeModelo("demo", "viejo")).toMatchObject({
      contextWindow: 128000, precio: { entrada: 1, salida: 2 },
    })
    // Precio cero es un plan de suscripción, no un precio: no se informa.
    expect(infoDeModelo("demo", "nuevo")!.precio).toBeUndefined()
    expect(infoDeModelo("demo", "nuevo")!.razona).toBe(true)
  })

  test("sin copia en disco devuelve vacío, y ahí manda el catálogo", async () => {
    process.env.PACKETSMITH_MODELS_PATH = join(tmpdir(), "no-existe-packetsmith.json")
    const { modelosDe } = await import(`../src/engine/providers/models-dev.ts?${Math.random()}`)
    expect(modelosDe("demo")).toEqual([])
  })
})

// Sin cubrir acá, y a propósito:
//
//   · el login de dispositivo de ChatGPT (`oauth-chatgpt.ts`), porque son tres
//     saltos contra el servidor de OpenAI y falsearlos probaría el falso;
//   · el turno completo de Responses contra el endpoint de Codex.
//
// Los dos necesitan una suscripción de ChatGPT viva. Lo que sí está probado de
// ese camino es la traducción, que es donde está la forma.
