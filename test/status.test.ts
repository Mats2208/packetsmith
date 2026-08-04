// Lo que la barra de estado dice de sí misma: fase, reloj, contexto y cuota.
// Todo esto sale de eventos que el CLI ya emitía y que hasta ahora tirábamos.
import { expect, test, describe } from "bun:test"
import { clock, compact } from "../src/tui/activity.tsx"
import { limitChip, plural, windowLabel } from "../src/tui/app.tsx"
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

  test("no dice 1 TURNOS", () => {
    expect(plural(1, "TURNO")).toBe("1 TURNO")
    expect(plural(0, "TURNO")).toBe("0 TURNOS")
    expect(plural(9, "NODO")).toBe("9 NODOS")
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
