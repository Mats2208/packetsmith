// Lo que la barra de estado dice de sí misma: fase, reloj, contexto y cuota.
// Todo esto sale de eventos que el CLI ya emitía y que hasta ahora tirábamos.
import { expect, test, describe } from "bun:test"
import { clock, compact } from "../src/tui/activity.tsx"
import { layoutKey, limitChip, untilReset, windowLabel, worthMapping } from "../src/tui/app.tsx"
import { setIdioma, T } from "../src/tui/i18n.ts"
import { readUsage, translate } from "../src/engine/claude.ts"
import type { AgentEvent } from "../src/engine/types.ts"

/** Corre `translate` sobre un objeto del stream y junta lo que sale. */
function events(raw: unknown): AgentEvent[] {
  return [...translate(raw, new Map())]
}

describe("formato", () => {
  test("los tokens se compactan pasando el millar", () => {
    // El razonamiento llega a decenas de miles: "18402 tok" no se lee de reojo.
    expect(compact(940)).toBe("940")
    expect(compact(1840)).toBe("1.8k")
    expect(compact(18_402)).toBe("18k")
    expect(compact(1_240_000)).toBe("1.2M")
  })

  test("el reloj pasa a minutos en vez de seguir contando segundos", () => {
    expect(clock(8_400)).toBe("8s")
    expect(clock(73_000)).toBe("1m13s")
  })

  test("no dice 1 TURNOS, en ninguno de los dos idiomas", () => {
    // Un "1 TURNOS" delata que nadie miró la pantalla. Y la regla del plural no
    // es la misma en los dos idiomas, así que vive en el diccionario y no en
    // una función que le pega una S al final.
    setIdioma("es")
    expect(T.turnos(1)).toBe("1 TURNO")
    expect(T.turnos(0)).toBe("0 TURNOS")
    expect(T.nodosBarra(9)).toBe("9 NODOS")

    setIdioma("en")
    expect(T.turnos(1)).toBe("1 TURN")
    expect(T.turnos(2)).toBe("2 TURNS")
    expect(T.nodos(1)).toBe("1 NODE")
    expect(T.enlaces(3)).toBe("3 LINKS")
  })

  test("la ventana de cuota se abrevia", () => {
    expect(windowLabel("five_hour")).toBe("5H")
    expect(windowLabel("seven_day")).toBe("7D")
    // Una ventana que no conocemos se muestra igual, no se esconde.
    expect(windowLabel("mensual")).toBe("MENSUAL")
  })
})

describe("chip de cuota", () => {
  const chip = (status: string) => limitChip({ window: "five_hour", status, resetsAt: 0 })

  test("el color solo aparece cuando hay algo que decidir", () => {
    // En verde no hay nada que hacer; el ámbar y el rojo sí cambian tu plan.
    expect(chip("allowed").text).toBe("5H ✓")
    expect(chip("allowed_warning").text).toBe("5H ⚠")
    expect(chip("rejected").text).toBe("5H ✗")
    expect(chip("allowed").fg).not.toBe(chip("allowed_warning").fg)
    expect(chip("rejected").fg).not.toBe(chip("allowed_warning").fg)
  })

  test("cuenta cuánto falta para el reinicio", () => {
    // El CLI da el instante del reinicio, no el porcentaje consumido. Con el
    // tope cerca, saber si faltan diez minutos o tres horas decide si conviene
    // seguir ahora o después.
    const t0 = 1_800_000_000_000
    expect(untilReset(t0 / 1000 + 42 * 60, t0)).toBe("42m")
    expect(untilReset(t0 / 1000 + 134 * 60, t0)).toBe("2h14")
    // Una ventana ya vencida no muestra un contador en cero ni negativo.
    expect(untilReset(t0 / 1000 - 60, t0)).toBe("")
  })

  test("el chip lleva la cuenta regresiva cuando la hay", () => {
    const t0 = 1_800_000_000_000
    const l = { window: "five_hour", status: "allowed", resetsAt: t0 / 1000 + 90 * 60 }
    expect(limitChip(l, t0).text).toBe("5H ✓ 1h30")
  })
})

describe("cuándo se dibuja el plano", () => {
  const dev = (name: string, x: number, y: number) =>
    ({ name, model: "2911", x, y, ports: [] })
  const link = { a: { device: "A", port: "" }, b: { device: "B", port: "" }, wireless: false }

  test("hace falta enlaces Y coordenadas", () => {
    // Sin enlaces no hay forma que mostrar; sin coordenadas tampoco:
    // `pt_query_topology` devuelve todo en (0,0) y saldrían todos apilados en
    // una celda.
    expect(worthMapping({ devices: [dev("A", 10, 10), dev("B", 50, 90)], links: [link] })).toBe(true)
    expect(worthMapping({ devices: [dev("A", 10, 10), dev("B", 50, 90)], links: [] })).toBe(false)
    expect(worthMapping({ devices: [dev("A", 0, 0), dev("B", 0, 0)], links: [link] })).toBe(false)
    expect(worthMapping({ devices: [dev("A", 10, 10)], links: [link] })).toBe(false)
  })

  test("mover un equipo cuenta como cambio de disposición", () => {
    // Es exactamente lo que el plano existe para mostrar, y un contador de
    // equipos no lo vería.
    const antes = { devices: [dev("A", 10, 10), dev("B", 50, 90)], links: [link] }
    const despues = { devices: [dev("A", 10, 10), dev("B", 300, 90)], links: [link] }
    expect(layoutKey(antes)).not.toBe(layoutKey(despues))
  })

  test("la misma red da la misma firma", () => {
    // Si no, el plano se repetiría en cada respuesta y sería papel tapiz.
    const t = { devices: [dev("A", 10, 10), dev("B", 50, 90)], links: [link] }
    expect(layoutKey(t)).toBe(layoutKey({ ...t }))
  })
})

describe("fases que el CLI ya anunciaba", () => {
  const block = (type: string, extra = {}) => ({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type, ...extra } },
  })

  test("un pedido en vuelo tiene su propia fase", () => {
    // Es el ÚNICO tramo sin ningún otro evento: sin esto, esperar la primera
    // respuesta y estar colgado se ven exactamente igual.
    expect(events({ type: "system", subtype: "status", status: "requesting" }))
      .toEqual([{ type: "phase", phase: "requesting" }])
  })

  test("el tipo de bloque dice si razona, escribe o llama una tool", () => {
    expect(events(block("thinking"))).toEqual([{ type: "phase", phase: "thinking" }])
    expect(events(block("text"))).toEqual([{ type: "phase", phase: "writing" }])
    expect(events(block("tool_use", { name: "pt_full_build" })))
      .toEqual([{ type: "phase", phase: "tool", detail: "pt_full_build" }])
  })

  test("los tokens de razonamiento llegan mientras no hay texto", () => {
    expect(events({ type: "system", subtype: "thinking_tokens", estimated_tokens: 51 }))
      .toEqual([{ type: "thinking", tokens: 51 }])
  })

  test("el turno termina en reposo, no en la última fase que hubo", () => {
    const out = events({ type: "result", total_cost_usd: 0.5, result: "listo" })
    expect(out.at(-1)).toEqual({ type: "phase", phase: "idle" })
  })
})

describe("cuota y contexto", () => {
  test("la cuota del plan viaja en el stream", () => {
    // No hace falta leer el token de OAuth del disco ni pegarle a un endpoint
    // aparte, que es lo que hay que hacer desde afuera del CLI.
    expect(events({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1785860400, rateLimitType: "five_hour" },
    })).toEqual([{
      type: "limits",
      limits: { window: "five_hour", status: "allowed", resetsAt: 1785860400 },
    }])
  })

  test("el contexto ocupado suma el caché, no solo la entrada directa", () => {
    // Mirando solo `input_tokens` daba 2 sobre un millón después de un turno
    // que había leído 15k de caché: el medidor decía cero para siempre.
    const usage = readUsage({
      model: "claude-opus-5[1m]",
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 15_273,
        cache_creation_input_tokens: 19_248,
        output_tokens: 4,
      },
      modelUsage: { "claude-opus-5[1m]": { contextWindow: 1_000_000 } },
    })
    expect(usage).toEqual({ tokens: 34_527, contextWindow: 1_000_000 })
  })

  test("el contexto es el último pedido, no la suma del turno", () => {
    // Un turno con varias tools son varios pedidos a la API, y `usage` de
    // arriba los SUMA. Como cada pedido relee el contexto entero desde caché,
    // sumarlos cuenta la misma conversación varias veces: dos turnos marcaban
    // 36% de un millón con un contexto real muy por debajo.
    const usage = readUsage({
      model: "m",
      usage: {
        input_tokens: 30,
        cache_read_input_tokens: 300_000,
        output_tokens: 300,
        iterations: [
          { input_tokens: 10, cache_read_input_tokens: 90_000, output_tokens: 100 },
          { input_tokens: 10, cache_read_input_tokens: 100_000, output_tokens: 100 },
          { input_tokens: 10, cache_read_input_tokens: 110_000, output_tokens: 100 },
        ],
      },
      modelUsage: { m: { contextWindow: 1_000_000 } },
    })
    expect(usage!.tokens).toBe(110_110)
  })

  test("la ventana es la del modelo principal, no la de un subagente", () => {
    // `modelUsage` trae una entrada por modelo usado: los subagentes de haiku
    // aparecen con sus 200k y tomarían el lugar del modelo de la sesión.
    const usage = readUsage({
      model: "desconocido",
      usage: { input_tokens: 100 },
      modelUsage: {
        "claude-haiku-4-5": { contextWindow: 200_000 },
        "claude-opus-5[1m]": { contextWindow: 1_000_000 },
      },
    })
    expect(usage!.contextWindow).toBe(1_000_000)
  })

  test("sin datos de uso no se inventa un medidor", () => {
    expect(readUsage({})).toBeUndefined()
    expect(readUsage({ usage: { input_tokens: 5 } })).toBeUndefined()
  })
})
