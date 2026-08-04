// El fixture reproduce los formatos verificados contra Claude Code real
// (2026-08), incluida una línea de banner no-JSON en el medio: los CLIs
// mezclan avisos con su salida estructurada y el parser tiene que sobrevivir.
// El fixture reproduce los formatos verificados contra Claude Code real
// (2026-08), incluida una línea de banner no-JSON en el medio: los CLIs
// mezclan avisos con su salida estructurada y el parser tiene que sobrevivir.
import { expect, test, describe } from "bun:test"
import { jsonLines } from "../src/engine/stream.ts"
import { buildArgs, translate } from "../src/engine/claude.ts"
import type { AgentEvent } from "../src/engine/types.ts"

const FIXTURE = new URL("./fixtures/claude-stream.ndjson", import.meta.url).pathname

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!
}

describe("buildArgs", () => {
  test("una lista vacía de tools manda \"\", no un flag pelado", () => {
    // `--allowedTools` sin valor hace que el CLI aborte con "argument missing".
    // Pasó de verdad en el primer smoke test contra claude real.
    const args = buildArgs({ prompt: "x", allowedTools: [] })
    const i = args.indexOf("--allowedTools")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("")
  })

  test("sin allowedTools no aparece el flag", () => {
    expect(buildArgs({ prompt: "x" })).not.toContain("--allowedTools")
  })

  test("pide streaming y los deltas parciales", () => {
    const args = buildArgs({ prompt: "x" })
    expect(args).toContain("stream-json")
    // Sin --verbose, stream-json no emite los stream_event y no hay deltas.
    expect(args).toContain("--verbose")
    expect(args).toContain("--include-partial-messages")
  })

  test("resume una sesión previa cuando se le pasa", () => {
    const args = buildArgs({ prompt: "x", sessionId: "sess-1" })
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1")
  })
})

describe("translate", () => {
  async function eventsFromFixture(): Promise<AgentEvent[]> {
    const text = await Bun.file(FIXTURE).text()
    const toolNames = new Map<string, string>()
    const out: AgentEvent[] = []
    for await (const raw of jsonLines(streamOf(text))) {
      out.push(...translate(raw, toolNames))
    }
    return out
  }

  test("los text_delta salen en orden y se pueden reensamblar", async () => {
    const text = (await eventsFromFixture())
      .filter((e) => e.type === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("")
    expect(text).toBe("Voy a consultar. Listo.")
  })

  test("tool_end recupera el nombre de la tool desde su tool_start", async () => {
    // El evento tool_result solo trae tool_use_id. Sin la correlación, el panel
    // de topología no sabría si el resultado es de pt_export_topology o de un
    // Read cualquiera.
    const ends = (await eventsFromFixture()).filter((e) => e.type === "tool_end")
    expect(ends).toHaveLength(2)
    expect(ends[0]).toMatchObject({
      id: "toolu_01",
      name: "mcp__packet-tracer__pt_export_topology",
      isError: false,
    })
  })

  test("marca los resultados con error en vez de darlos por buenos", async () => {
    const ends = (await eventsFromFixture()).filter((e) => e.type === "tool_end")
    expect(ends[1]).toMatchObject({ name: "mcp__packet-tracer__pt_add_device", isError: true })
  })

  test("done trae sesión y costo para poder continuar el turno", async () => {
    const done = (await eventsFromFixture()).find((e) => e.type === "done")
    expect(done).toMatchObject({ sessionId: "sess-abc", costUsd: 0.0123 })
  })

  test("un tool_result huérfano no rompe: queda como unknown", async () => {
    // Puede pasar si el stream arranca a mitad de un turno reanudado.
    const raw = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "nunca-visto", content: "x" }] },
    }
    const got = [...translate(raw, new Map())]
    expect(got[0]).toMatchObject({ name: "unknown", id: "nunca-visto" })
  })

  test("ignora los tipos de evento que no le interesan", async () => {
    for (const t of ["system", "rate_limit_event", "message_stop"]) {
      expect([...translate({ type: t }, new Map())]).toHaveLength(0)
    }
  })
})
