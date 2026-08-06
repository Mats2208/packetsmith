// El fixture reproduce los formatos verificados contra Claude Code real
// (2026-08), incluida una línea de banner no-JSON en el medio: los CLIs
// mezclan avisos con su salida estructurada y el parser tiene que sobrevivir.
import { expect, test, describe } from "bun:test"
import { join } from "node:path"
import { jsonLines } from "../src/engine/stream.ts"
import { buildArgs, resolveBin, translate } from "../src/engine/claude.ts"
import type { AgentEvent } from "../src/engine/types.ts"

// `import.meta.dir` y no `new URL(...).pathname`: en Windows esa propiedad
// devuelve "/E:/PROYECTOS/..." —con la barra de más adelante de la letra de
// unidad— y `Bun.file` no lo puede abrir. Los cinco tests de este bloque
// fallaban con ENOENT en cualquier máquina Windows.
const FIXTURE = join(import.meta.dir, "fixtures", "claude-stream.ndjson")

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

  test("el prompt multilínea va ÚLTIMO, después de todo lo demás", () => {
    // No es cosmético. El valor de --append-system-prompt tiene saltos de línea,
    // y detrás de un shim .cmd (el que deja npm en Windows) cmd.exe corta la
    // línea de comandos en el primer salto y pierde TODO lo que siga. Con el
    // prompt en el medio, ahí se iban --mcp-config, --strict-mcp-config,
    // --model y --allowedTools: el agente arrancaba con todos los servidores
    // MCP del usuario y el modelo por defecto, en silencio.
    const args = buildArgs({
      model: "opus",
      allowedTools: ["Read"],
      mcpArgs: ["--mcp-config", "/tmp/x.json", "--strict-mcp-config"],
    })
    expect(args.indexOf("--append-system-prompt")).toBe(args.length - 2)
    expect(args[args.length - 1]).toContain("\n")
    // Y todo lo que importa quedó ANTES.
    for (const flag of ["--mcp-config", "--strict-mcp-config", "--model", "--allowedTools"]) {
      expect(args.indexOf(flag)).toBeLessThan(args.indexOf("--append-system-prompt"))
    }
  })
})

describe("resolveBin", () => {
  // `npm i -g` deja un shim .cmd, no un ejecutable. Ese shim reenvía con `%*`
  // y cmd.exe no sabe pasar un argumento con saltos de línea.
  test("en Windows se salta el shim si el ejecutable real está", () => {
    const bin = resolveBin(
      () => "C:\\nvm4w\\nodejs\\claude.cmd",
      () => true,
      "win32",
    )
    expect(bin.endsWith("claude.exe")).toBe(true)
    expect(bin).toContain("@anthropic-ai")
  })

  test("si el ejecutable real no está, se queda con el shim", () => {
    // Peor arrancar con el shim que no arrancar.
    expect(resolveBin(() => "C:\\x\\claude.cmd", () => false, "win32")).toBe("C:\\x\\claude.cmd")
  })

  test("fuera de Windows no toca nada", () => {
    // En macOS y Linux `claude` es un ejecutable de verdad, no un shim, así que
    // el problema no existe y acá no hay nada que corregir. Se prueba explícito
    // porque este proyecto se desarrolla en macOS: un cambio pensado para
    // Windows no tiene derecho a mover el comportamiento del otro lado.
    for (const so of ["darwin", "linux"] as const) {
      expect(resolveBin(() => "/usr/local/bin/claude", () => true, so)).toBe("/usr/local/bin/claude")
    }
  })

  test("si no está en el PATH se intenta igual con el nombre pelado", () => {
    expect(resolveBin(() => null, () => false, "win32")).toBe("claude")
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

describe("líneas que el parser no puede leer", () => {
  // `jsonLines` acepta un `onSkip` justamente para no tragarse nada en
  // silencio, y no lo llamaba nadie. La distinción importa: un banner es
  // normal y no hay que avisarlo, un JSON cortado es un evento PERDIDO.
  test("un banner no es un error, un JSON cortado sí", async () => {
    const avisados: string[] = []
    const stream = streamOf(
      '{"type":"system","subtype":"init","session_id":"s","model":"m","tools":[]}\n' +
      "Nueva versión de claude disponible: 2.2.0\n" +
      '{"type":"result","total_cost\n',
    )
    for await (const _ of jsonLines(stream, (l) => {
      if (l.trimStart().startsWith("{")) avisados.push(l)
    })) { /* drenar */ }

    expect(avisados).toHaveLength(1)
    expect(avisados[0]).toContain("total_cost")
  })
})
