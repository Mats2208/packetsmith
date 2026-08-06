// El bucle de agente y el parseo del streaming.
//
// Acá está el riesgo real de tener motor propio: los argumentos de una tool NO
// llegan enteros. Vienen partidos entre muchos deltas, a veces sin id en el
// medio, y hay que acumularlos por ÍNDICE como texto crudo y parsearlos recién
// al cierre. Todo lo demás del provider es tubería.
//
// Se prueba contra un servidor HTTP de verdad levantado acá, y no contra un
// mock de fetch: lo que se quiere verificar es el parseo de un stream SSE
// partido en chunks feos, y eso un mock no lo reproduce.
import { expect, test, describe, afterEach } from "bun:test"
import { turno, type Mensaje, type ProviderConfig } from "../src/engine/providers/openai-compat.ts"
import { Agent } from "../src/engine/agent.ts"
import type { McpClient } from "../src/mcp/client.ts"

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => { server?.stop(true); server = undefined })

/** Levanta un proveedor falso que escupe los chunks dados, tal cual. */
function proveedor(chunks: string[], status = 200): ProviderConfig {
  server = Bun.serve({
    port: 0,
    fetch() {
      if (status !== 200) return new Response("se rompió todo", { status })
      const cuerpo = new ReadableStream({
        start(c) {
          const enc = new TextEncoder()
          for (const ch of chunks) c.enqueue(enc.encode(ch))
          c.close()
        },
      })
      return new Response(cuerpo, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return {
    baseUrl: `http://localhost:${server.port}/v1`,
    apiKey: "no-importa",
    model: "kimi-k2-turbo-preview",
  }
}

const MSG: Mensaje[] = [{ role: "user", content: "hola" }]

/** Corre el turno entero y devuelve los trozos y el resumen. */
async function correr(cfg: ProviderConfig, tools: any[] = []) {
  const trozos: any[] = []
  const g = turno(cfg, MSG, tools)
  let r = await g.next()
  while (!r.done) { trozos.push(r.value); r = await g.next() }
  return { trozos, fin: r.value }
}

const data = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
const delta = (d: unknown, finish?: string) =>
  data({ choices: [{ delta: d, finish_reason: finish ?? null }] })

describe("texto y razonamiento", () => {
  test("los deltas de texto salen en orden y se reensamblan", async () => {
    const { trozos, fin } = await correr(proveedor([
      delta({ content: "Tres " }), delta({ content: "routers" }), delta({}, "stop"), "data: [DONE]\n\n",
    ]))
    expect(trozos.filter((t) => t.tipo === "texto").map((t) => t.delta).join("")).toBe("Tres routers")
    expect(fin.texto).toBe("Tres routers")
    expect(fin.motivo).toBe("stop")
  })

  test("el razonamiento viaja por su propio canal", async () => {
    // Los modelos que piensan mandan casi todo por `reasoning_content` antes de
    // la primera letra. Si no se lo mira, parece que están colgados.
    const { trozos, fin } = await correr(proveedor([
      delta({ reasoning_content: "a ver…" }), delta({ content: "listo" }), delta({}, "stop"),
    ]))
    expect(trozos.find((t) => t.tipo === "razonando")?.delta).toBe("a ver…")
    // Y NO se mezcla con la respuesta.
    expect(fin.texto).toBe("listo")
  })
})

describe("tool calls partidas", () => {
  test("los argumentos se acumulan entre deltas y se parsean al final", async () => {
    // El caso que rompe una implementación ingenua: el JSON llega a pedazos y
    // parsear antes de tiempo revienta con un objeto a medias.
    const { fin } = await correr(proveedor([
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "pt_add_device", arguments: '{"na' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: 'me":"R1","mod' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: 'el":"2911"}' } }] }),
      delta({}, "tool_calls"),
    ]))
    expect(fin.calls).toHaveLength(1)
    expect(fin.calls[0]!.function.name).toBe("pt_add_device")
    expect(JSON.parse(fin.calls[0]!.function.arguments)).toEqual({ name: "R1", model: "2911" })
    expect(fin.motivo).toBe("tool_calls")
  })

  test("se acumula por ÍNDICE, no por id", async () => {
    // Los deltas del medio suelen traer solo el índice. Emparejar por id
    // perdería todo lo que viene después del primero.
    const { fin } = await correr(proveedor([
      delta({ tool_calls: [{ index: 0, id: "a", function: { name: "uno", arguments: "{}" } }] }),
      delta({ tool_calls: [{ index: 1, id: "b", function: { name: "dos", arguments: '{"x":' } }] }),
      delta({ tool_calls: [{ index: 1, function: { arguments: "1}" } }] }),
      delta({}, "tool_calls"),
    ]))
    expect(fin.calls.map((c) => c.function.name)).toEqual(["uno", "dos"])
    expect(JSON.parse(fin.calls[1]!.function.arguments)).toEqual({ x: 1 })
  })

  test("una tool sin parámetros no es un error", async () => {
    // `pt_bridge_status` no lleva argumentos y el modelo manda "" o nada.
    const { fin } = await correr(proveedor([
      delta({ tool_calls: [{ index: 0, id: "c", function: { name: "pt_bridge_status", arguments: "" } }] }),
      delta({}, "tool_calls"),
    ]))
    expect(fin.calls[0]!.function.arguments).toBe("{}")
  })

  test("un JSON roto falla en el borde, con el nombre de la tool", async () => {
    // Falla acá y no tres capas más abajo, cuando ya no se sabe cuál fue.
    const cfg = proveedor([
      delta({ tool_calls: [{ index: 0, id: "c", function: { name: "pt_apply_vlan", arguments: "{roto" } }] }),
      delta({}, "tool_calls"),
    ])
    expect(correr(cfg)).rejects.toThrow(/pt_apply_vlan/)
  })

  test("si pidió tools, el motivo es tool_calls aunque diga stop", async () => {
    // Pasa con varios proveedores compatibles, y si se les cree el bucle corta
    // el turno sin ejecutar nada.
    const { fin } = await correr(proveedor([
      delta({ tool_calls: [{ index: 0, id: "c", function: { name: "t", arguments: "{}" } }] }),
      delta({}, "stop"),
    ]))
    expect(fin.motivo).toBe("tool_calls")
  })
})

describe("uso y errores", () => {
  test("el conteo de tokens llega en un chunk sin choices", async () => {
    const { fin } = await correr(proveedor([
      delta({ content: "ok" }, "stop"),
      data({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 45 } }),
    ]))
    expect(fin.uso).toEqual({ entrada: 1200, salida: 45 })
  })

  test("un HTTP que falla dice el código y el cuerpo", async () => {
    // Una key vencida tiene que decir "401", no "algo salió mal".
    expect(correr(proveedor([], 401))).rejects.toThrow(/401/)
  })
})

describe("el bucle de agente", () => {
  /** Un MCP falso que anota qué le pidieron. */
  const mcpFalso = (llamadas: { name: string; args: unknown }[], salida = "OK") => ({
    tools: [{ name: "pt_add_device", description: "", inputSchema: { type: "object" } }],
    info: {},
    async call(name: string, args: unknown) {
      llamadas.push({ name, args })
      return { content: [{ type: "text", text: salida }], isError: false }
    },
    close() {},
  }) as unknown as McpClient

  /** Un proveedor que da respuestas distintas en cada vuelta. */
  function porVuelta(vueltas: string[][]): ProviderConfig {
    let i = 0
    server = Bun.serve({
      port: 0,
      fetch() {
        const chunks = vueltas[Math.min(i++, vueltas.length - 1)]!
        return new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder()
              for (const ch of chunks) c.enqueue(enc.encode(ch))
              c.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    return { baseUrl: `http://localhost:${server.port}/v1`, apiKey: "x", model: "m" }
  }

  /** Junta los eventos hasta que el turno cierra. */
  async function turnoCompleto(agent: Agent, texto: string) {
    const eventos: any[] = []
    agent.send(texto)
    for await (const ev of agent.events()) {
      eventos.push(ev)
      if (ev.type === "turn_end" || ev.type === "error") break
    }
    return eventos
  }

  test("ejecuta la tool y sigue hasta contestar", async () => {
    // Es la razón de ser de todo esto: el modelo pide, nosotros ejecutamos
    // contra Packet Tracer, le devolvemos el resultado, y recién ahí contesta.
    const llamadas: { name: string; args: unknown }[] = []
    const provider = porVuelta([
      [delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "pt_add_device", arguments: '{"name":"R1","model":"2911"}' } }] }), delta({}, "tool_calls")],
      [delta({ content: "Listo, R1 creado." }), delta({}, "stop")],
    ])
    const agent = new Agent({ provider, mcp: mcpFalso(llamadas), systemPrompt: "sos un agente" })
    const eventos = await turnoCompleto(agent, "creá un router")
    agent.close()

    expect(llamadas).toEqual([{ name: "pt_add_device", args: { name: "R1", model: "2911" } }])
    expect(eventos.find((e) => e.type === "tool_start")?.name).toBe("pt_add_device")
    expect(eventos.find((e) => e.type === "tool_end")?.isError).toBe(false)
    expect(eventos.find((e) => e.type === "turn_end")?.text).toBe("Listo, R1 creado.")
  })

  test("las tools del MCP se le ofrecen al modelo tal como vienen", async () => {
    // El esquema lo declara el servidor MCP. Si acá se declarara una lista
    // propia, quedaría vieja apenas el MCP agregue una tool.
    const agent = new Agent({
      provider: porVuelta([[delta({ content: "ok" }, "stop")]]),
      mcp: mcpFalso([]),
      systemPrompt: "x",
    })
    const eventos = await turnoCompleto(agent, "hola")
    agent.close()
    expect(eventos.find((e) => e.type === "ready")?.tools).toEqual(["pt_add_device"])
  })

  test("una tool que falla no corta el turno: el modelo se entera", async () => {
    // Media gracia de tener un agente es que pueda corregir. Si el error no le
    // llega, no puede.
    const mcp = {
      tools: [{ name: "pt_add_device", inputSchema: {} }],
      info: {},
      async call() { return { content: "DUPLICATE: ya existe", isError: true } },
      close() {},
    } as unknown as McpClient

    const agent = new Agent({
      provider: porVuelta([
        [delta({ tool_calls: [{ index: 0, id: "c", function: { name: "pt_add_device", arguments: "{}" } }] }), delta({}, "tool_calls")],
        [delta({ content: "Ya existía, uso el que hay." }), delta({}, "stop")],
      ]),
      mcp,
      systemPrompt: "x",
    })
    const eventos = await turnoCompleto(agent, "creá R1")
    agent.close()

    expect(eventos.find((e) => e.type === "tool_end")?.isError).toBe(true)
    expect(eventos.find((e) => e.type === "turn_end")?.text).toBe("Ya existía, uso el que hay.")
  })

  test("un modelo que se traba pidiendo tools se corta solo", async () => {
    // Sin tope, un modelo en bucle gastaría la cuota entera sin que nadie lo
    // pare. Se contesta SIEMPRE la misma tool call.
    const agent = new Agent({
      provider: porVuelta([[
        delta({ tool_calls: [{ index: 0, id: "c", function: { name: "pt_add_device", arguments: "{}" } }] }),
        delta({}, "tool_calls"),
      ]]),
      mcp: mcpFalso([]),
      systemPrompt: "x",
    })
    const eventos = await turnoCompleto(agent, "dale")
    agent.close()
    expect(eventos.at(-1)?.type).toBe("error")
    expect(eventos.at(-1)?.message).toMatch(/se cortó el turno/)
  }, 30_000)

  test("send() sobre una sesión cerrada devuelve false", async () => {
    const agent = new Agent({
      provider: porVuelta([[delta({ content: "x" }, "stop")]]),
      mcp: mcpFalso([]),
      systemPrompt: "x",
    })
    agent.close()
    expect(agent.send("hola")).toBe(false)
  })
})

describe("el stream SSE", () => {
  test("sobrevive a que los eventos lleguen partidos entre chunks", async () => {
    // El corte de los chunks de red no respeta los `\n\n`. Es el mismo problema
    // que ya tenía el NDJSON del CLI, y se rompe igual de feo.
    const entero = delta({ content: "hola" }) + delta({}, "stop")
    const partido = []
    for (let i = 0; i < entero.length; i += 7) partido.push(entero.slice(i, i + 7))

    const { fin } = await correr(proveedor(partido))
    expect(fin.texto).toBe("hola")
  })

  test("una línea que no es JSON no mata el turno", async () => {
    const { fin } = await correr(proveedor([
      "data: {no soy json\n\n", delta({ content: "igual sigo" }), delta({}, "stop"),
    ]))
    expect(fin.texto).toBe("igual sigo")
  })
})
