// Adapter de Claude Code CLI.
//
// Mismos flags que hyprdesk/cli/adapters/claude.mjs (`-p`, `--resume`,
// `--allowedTools`) con un cambio de fondo: `--output-format stream-json` en
// vez de `json`. El primero emite NDJSON evento por evento mientras el agente
// trabaja; el segundo devuelve un solo objeto cuando ya terminó.
//
// Formatos verificados contra Claude Code (2026-08):
//   stream_event / content_block_delta  → delta.text     (texto incremental)
//   assistant  → message.content[] con {type:"tool_use", id, name, input}
//   user       → message.content[] con {type:"tool_result", tool_use_id, content}
//   result     → session_id, total_cost_usd, result
import type { AgentEvent, Engine, RunOpts } from "./types.ts"
import { jsonLines } from "./stream.ts"

/** `--include-partial-messages` es lo que hace que lleguen los text_delta. */
export function buildArgs(opts: RunOpts): string[] {
  const args = [
    "-p", opts.prompt,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose", // sin esto stream-json no emite los stream_event
  ]
  if (opts.model) args.push("--model", opts.model)
  if (opts.sessionId) args.push("--resume", opts.sessionId)
  if (opts.allowedTools) {
    // Lista vacía = "sin ninguna tool", pero el flag igual necesita un valor:
    // `--allowedTools` a secas hace que el CLI aborte con "argument missing".
    args.push("--allowedTools", ...(opts.allowedTools.length ? opts.allowedTools : [""]))
  }
  return args
}

/** Extrae los AgentEvent de un objeto del stream. Exportado para testear sin spawn. */
export function* translate(
  raw: unknown,
  toolNames: Map<string, string>,
): Generator<AgentEvent> {
  if (typeof raw !== "object" || raw === null) return
  const ev = raw as Record<string, any>

  switch (ev.type) {
    case "stream_event": {
      const inner = ev.event
      if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        yield { type: "text", delta: String(inner.delta.text ?? "") }
      }
      return
    }

    case "assistant": {
      for (const block of ev.message?.content ?? []) {
        if (block?.type === "tool_use") {
          // Se recuerda el nombre porque el tool_result solo trae el id: sin
          // este mapa no habría forma de saber qué tool produjo qué salida.
          toolNames.set(block.id, block.name)
          yield { type: "tool_start", id: block.id, name: block.name, input: block.input }
        }
      }
      return
    }

    case "user": {
      for (const block of ev.message?.content ?? []) {
        if (block?.type === "tool_result") {
          const id = block.tool_use_id
          yield {
            type: "tool_end",
            id,
            name: toolNames.get(id) ?? "unknown",
            output: block.content,
            isError: block.is_error === true,
          }
        }
      }
      return
    }

    case "result": {
      yield {
        type: "done",
        sessionId: String(ev.session_id ?? ""),
        costUsd: Number(ev.total_cost_usd ?? 0),
        text: String(ev.result ?? ""),
      }
      return
    }
  }
}

export const claude: Engine = {
  name: "claude",

  async *run(opts: RunOpts): AsyncIterable<AgentEvent> {
    const proc = Bun.spawn(["claude", ...buildArgs(opts)], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
      signal: opts.signal,
    })

    // id de tool → nombre. Vive por corrida: los ids no se repiten entre turnos.
    const toolNames = new Map<string, string>()

    try {
      for await (const raw of jsonLines(proc.stdout)) {
        yield* translate(raw, toolNames)
      }
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) }
      return
    }

    const code = await proc.exited
    if (code !== 0) {
      // stderr recién acá: mientras corre no aporta, y si salió bien no importa.
      const err = await new Response(proc.stderr).text()
      yield { type: "error", message: `claude salió con código ${code}: ${err.slice(0, 500)}` }
    }
  },
}
