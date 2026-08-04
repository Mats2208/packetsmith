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
  test("abre la sesión en modo bidireccional", () => {
    // Sin --input-format stream-json no hay conversación: habría que relanzar
    // el proceso por cada mensaje, que es lo que hacía v0.1.
    const args = buildArgs({})
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json")
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json")
  })

  test("resuelve los permisos sin humano en el medio", () => {
    // En sesión no interactiva nadie puede aprobar una tool: sin esto TODAS
    // fallaban con "permissions not granted" y el panel nunca recibía datos.
    const args = buildArgs({})
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions")
  })

  test("pide los deltas parciales", () => {
    const args = buildArgs({})
    // Sin --verbose, stream-json no emite los stream_event y no hay deltas.
    expect(args).toContain("--verbose")
    expect(args).toContain("--include-partial-messages")
  })

  test("una lista vacía de tools manda \"\", no un flag pelado", () => {
    // `--allowedTools` sin valor hace que el CLI aborte con "argument missing".
    // Pasó de verdad en el primer smoke test contra claude real.
    const args = buildArgs({ allowedTools: [] })
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("")
  })

  test("sin allowedTools no aparece el flag", () => {
    expect(buildArgs({})).not.toContain("--allowedTools")
  })

  test("pasa el modelo cuando se elige", () => {
    expect(buildArgs({ model: "opus" })[buildArgs({ model: "opus" }).indexOf("--model") + 1]).toBe("opus")
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

  test("el init informa sesión, modelo y cuántas tools hay", async () => {
    const ready = (await eventsFromFixture()).find((e) => e.type === "ready")
    expect(ready).toMatchObject({ sessionId: "sess-abc", model: "claude-sonnet-5" })
    expect((ready as any).tools).toHaveLength(1)
  })

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

  test("turn_end cierra el turno, no la sesión", async () => {
    const end = (await eventsFromFixture()).find((e) => e.type === "turn_end")
    expect(end).toMatchObject({ costUsd: 0.0123 })
  })

  test("un tool_result huérfano no rompe: queda como unknown", async () => {
    const raw = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "nunca-visto", content: "x" }] },
    }
    expect([...translate(raw, new Map())][0]).toMatchObject({ name: "unknown" })
  })

  test("ignora los tipos de evento que no le interesan", () => {
    for (const t of ["rate_limit_event", "message_stop"]) {
      expect([...translate({ type: t }, new Map())]).toHaveLength(0)
    }
  })
})
