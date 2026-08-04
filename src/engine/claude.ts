// Adapter de Claude Code CLI, como sesión persistente.
//
// v0.1 hacía `claude -p` una vez por mensaje: eso no era una conversación sino
// una serie de monólogos, y encima en modo no interactivo toda tool caía con
// "permissions not granted" porque nadie podía aprobarlas.
//
// Ahora es UN proceso vivo con entrada y salida en NDJSON:
//   --input-format  stream-json  → se le escriben mensajes por stdin
//   --output-format stream-json  → emite eventos según ocurren
//   --permission-mode            → resuelve permisos sin humano en el medio
//
// Medido: 6.1s el primer turno, 1.5s el segundo. La diferencia es no tener que
// relanzar el proceso ni recargar el contexto.
//
// Formatos verificados contra Claude Code (2026-08):
//   system/init → session_id, model, tools
//   stream_event / content_block_delta → delta.text
//   assistant → content[] con {type:"tool_use", id, name, input}
//   user      → content[] con {type:"tool_result", tool_use_id, content}
//   result    → total_cost_usd, result   (fin de turno, NO de sesión)
import type { AgentEvent, Engine, Session, StartOpts } from "./types.ts"
import { jsonLines } from "./stream.ts"

export function buildArgs(opts: StartOpts): string[] {
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose", // sin esto stream-json no emite los stream_event
    // Sin esto el agente pide permiso, nadie puede darlo porque no hay sesión
    // interactiva, y TODA tool falla. Era la razón de que el panel de
    // topología nunca se llenara.
    "--permission-mode", "bypassPermissions",
  ]
  if (opts.model) args.push("--model", opts.model)
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
    case "system":
      if (ev.subtype === "init") {
        yield {
          type: "ready",
          sessionId: String(ev.session_id ?? ""),
          model: String(ev.model ?? ""),
          tools: Array.isArray(ev.tools) ? ev.tools.map(String) : [],
        }
      }
      return

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

    case "result":
      yield {
        type: "turn_end",
        costUsd: Number(ev.total_cost_usd ?? 0),
        text: String(ev.result ?? ""),
      }
      return
  }
}

/** Un mensaje del usuario en el formato que espera `--input-format stream-json`. */
function userMessage(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  }) + "\n"
}

export const claude: Engine = {
  name: "claude",

  start(opts: StartOpts): Session {
    const proc = Bun.spawn(["claude", ...buildArgs(opts)], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
    })

    // id de tool → nombre. Vive por sesión: los ids no se repiten.
    const toolNames = new Map<string, string>()
    let closed = false

    return {
      send(text: string) {
        if (closed) return
        proc.stdin.write(userMessage(text))
        proc.stdin.flush()
      },

      async *events(): AsyncIterable<AgentEvent> {
        try {
          for await (const raw of jsonLines(proc.stdout)) {
            yield* translate(raw, toolNames)
          }
        } catch (e) {
          yield { type: "error", message: e instanceof Error ? e.message : String(e) }
          return
        }
        // Si el stdout se cerró sin que nosotros cerráramos, el CLI murió.
        if (!closed) {
          const err = await new Response(proc.stderr).text()
          yield { type: "error", message: `claude terminó: ${err.slice(0, 400) || "sin stderr"}` }
        }
      },

      close() {
        closed = true
        proc.stdin.end()
        proc.kill()
      },
    }
  },
}
