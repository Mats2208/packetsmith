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
import { existsSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { AgentEvent, Engine, Session, StartOpts } from "./types.ts"
import { jsonLines } from "./stream.ts"
import { SYSTEM_PROMPT } from "./prompt.ts"
import { scopeToPacketTracer } from "./mcp.ts"

export function buildArgs(opts: StartOpts & { mcpArgs?: string[] }): string[] {
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
  // Acota el agente al MCP de Packet Tracer. Sin esto hereda toda la config
  // del usuario, y sus definiciones de tools viajan en cada pedido.
  if (opts.mcpArgs?.length) args.push(...opts.mcpArgs)
  if (opts.model) args.push("--model", opts.model)
  if (opts.effort) args.push("--effort", opts.effort)
  // Reanudar una conversación anterior. Es lo que hace que cambiar de modelo no
  // cueste el contexto: se relanza el proceso sobre la misma sesión.
  if (opts.resume) args.push("--resume", opts.resume)
  if (opts.allowedTools) {
    // Lista vacía = "sin ninguna tool", pero el flag igual necesita un valor:
    // `--allowedTools` a secas hace que el CLI aborte con "argument missing".
    args.push("--allowedTools", ...(opts.allowedTools.length ? opts.allowedTools : [""]))
  }
  // Sin esto el agente es Claude Code generico: no sabe que hay un panel de
  // topologia a la derecha ni que el ancho util son ~70 columnas, asi que
  // contesta con informes largos y repite en prosa lo que el panel ya
  // muestra. `--append-system-prompt` suma al suyo en vez de reemplazarlo.
  //
  // Va ÚLTIMO y no en el medio, y esto no es cosmético: su valor tiene saltos
  // de línea, y si el CLI queda detrás de un shim .cmd (como el que deja npm en
  // Windows) cmd.exe corta la línea de comandos en el primer salto y se lleva
  // puesto TODO lo que venga después. Con el prompt en el medio, eso eran
  // `--mcp-config`, `--strict-mcp-config`, `--model` y `--allowedTools`:
  // desaparecían en silencio y el agente arrancaba con los 11 servidores MCP
  // del usuario y el modelo por defecto. Medido. Poniéndolo al final, lo peor
  // que puede pasar es que se recorte el prompt.
  args.push("--append-system-prompt", SYSTEM_PROMPT)
  return args
}

/**
 * Con qué binario arrancar el CLI.
 *
 * `npm i -g` no deja un ejecutable en el PATH sino un shim `.cmd` que reenvía
 * `%*`, y cmd.exe no sabe pasar un argumento con saltos de línea: corta ahí y
 * pierde el resto. Lanzando el ejecutable real se pasa por CreateProcess y el
 * argumento llega entero.
 *
 * Si no se encuentra —instalación nativa, otro layout, otro sistema— se vuelve
 * a "claude" a secas, que es el comportamiento de siempre.
 */
export function resolveBin(
  which: (cmd: string) => string | null = Bun.which,
  exists: (p: string) => boolean = existsSync,
  platform = process.platform,
): string {
  const found = which("claude")
  if (!found || platform !== "win32" || !/\.(cmd|bat|ps1)$/i.test(found)) return found ?? "claude"
  const real = join(dirname(found), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
  return exists(real) ? real : found
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
      // El CLI avisa cuándo tiene un pedido en vuelo. Es el único tramo en el
      // que NO llega nada más: sin esto, esperar la primera respuesta y estar
      // colgado se ven igual.
      if (ev.subtype === "status" && ev.status === "requesting") {
        yield { type: "phase", phase: "requesting" }
      }
      if (ev.subtype === "thinking_tokens") {
        yield { type: "thinking", tokens: Number(ev.estimated_tokens ?? 0) }
      }
      return

    // La cuota del plan viaja en el stream. No hace falta leer el token de
    // OAuth del disco ni pegarle a un endpoint aparte, que es lo que hay que
    // hacer desde afuera del CLI.
    case "rate_limit_event": {
      const info = ev.rate_limit_info
      if (!info) return
      yield {
        type: "limits",
        limits: {
          window: String(info.rateLimitType ?? ""),
          status: String(info.status ?? ""),
          resetsAt: Number(info.resetsAt ?? 0),
        },
      }
      return
    }

    case "stream_event": {
      const inner = ev.event

      // El tipo de bloque que arranca dice en qué anda: razonar, escribir o
      // llamar una tool. Los tres se veían igual —silencio— hasta ahora.
      if (inner?.type === "content_block_start") {
        const kind = inner.content_block?.type
        if (kind === "thinking") yield { type: "phase", phase: "thinking" }
        if (kind === "text") yield { type: "phase", phase: "writing" }
        if (kind === "tool_use") {
          yield { type: "phase", phase: "tool", detail: String(inner.content_block?.name ?? "") }
        }
      }

      if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        yield { type: "text", delta: String(inner.delta.text ?? "") }
      }
      // Claude emite UN bloque de texto por tramo de razonamiento —típicamente
      // uno antes de cada tool. Sin separarlos, el final de uno se pega al
      // comienzo del siguiente: "…en el canvas.Bridge conectado. Reviso…".
      if (inner?.type === "content_block_stop") {
        yield { type: "text", delta: "\n\n" }
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
      const usage = readUsage(ev)
      yield {
        type: "turn_end",
        costUsd: Number(ev.total_cost_usd ?? 0),
        text: String(ev.result ?? ""),
        ...(usage ? { usage } : {}),
      }
      yield { type: "phase", phase: "idle" }
      return
    }
  }
}

/**
 * Cuánto contexto ocupa la conversación después del turno.
 *
 * Se lee la ÚLTIMA iteración, no el total del turno. Esto es lo que hacía que
 * el medidor mintiera: un turno con cinco tools son cinco pedidos a la API, y
 * `usage` de arriba los SUMA. Como cada pedido relee el contexto entero desde
 * caché, sumarlos cuenta la misma conversación cinco veces — dos turnos
 * marcaban 36% de un millón cuando el contexto real era una fracción de eso.
 * El contexto no es acumulativo: es el tamaño del último prompt.
 *
 * Dentro de una iteración sí se suman los cuatro contadores, porque los tres de
 * entrada —directa, caché leído y caché escrito— ocupan ventana igual: mirar
 * solo `input_tokens` daba 2 sobre un millón después de un pedido que había
 * leído 15k de caché.
 *
 * La ventana sale de `modelUsage`, que trae una entrada por modelo usado —los
 * subagentes de haiku aparecen ahí con sus 200k. Se busca la del modelo de la
 * sesión y, si no está, se toma la ventana más grande: el modelo principal es
 * siempre el de más contexto, nunca un subagente.
 */
export function readUsage(ev: Record<string, any>): { tokens: number; contextWindow: number } | undefined {
  const u = ev.usage
  if (!u) return undefined

  const last = Array.isArray(u.iterations) && u.iterations.length
    ? u.iterations[u.iterations.length - 1]
    : u

  const tokens =
    Number(last.input_tokens ?? 0) +
    Number(last.cache_read_input_tokens ?? 0) +
    Number(last.cache_creation_input_tokens ?? 0) +
    Number(last.output_tokens ?? 0)

  const models: Record<string, any> = ev.modelUsage ?? {}
  const windows = Object.values(models).map((m: any) => Number(m?.contextWindow ?? 0))
  const contextWindow = Number(models[ev.model]?.contextWindow ?? 0) || Math.max(0, ...windows)

  return contextWindow ? { tokens, contextWindow } : undefined
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
    const cwd = opts.cwd ?? process.cwd()
    const mcp = scopeToPacketTracer(homedir(), cwd)
    const proc = Bun.spawn([resolveBin(), ...buildArgs({ ...opts, mcpArgs: mcp.args })], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
    })

    // id de tool → nombre. Vive por sesión: los ids no se repiten.
    const toolNames = new Map<string, string>()
    let closed = false
    // El stdout se acabó: el CLI no va a contestar nada más, lo hayamos cerrado
    // nosotros o se haya muerto solo.
    let terminado = false

    return {
      send(text: string): boolean {
        if (closed || terminado) return false
        proc.stdin.write(userMessage(text))
        proc.stdin.flush()
        return true
      },

      async *events(): AsyncIterable<AgentEvent> {
        // Líneas que el parser no pudo leer. `onSkip` avisa desde adentro de la
        // iteración, donde no se puede hacer yield, así que se juntan acá y se
        // emiten en el próximo tramo del bucle.
        const ilegibles: string[] = []
        const avisos = function* (): Generator<AgentEvent> {
          while (ilegibles.length) {
            yield { type: "error", message: `evento ilegible del CLI: ${ilegibles.shift()!.slice(0, 200)}` }
          }
        }

        try {
          for await (const raw of jsonLines(proc.stdout, (line) => {
            // Los CLIs mezclan banners y avisos de actualización con su salida
            // estructurada, y esos no son un problema. Una línea que EMPIEZA
            // con '{' y aun así no parsea es otra cosa: es un evento que se
            // perdió, y tragárselo en silencio es cómo se pierde sin que nadie
            // sepa por qué.
            if (line.trimStart().startsWith("{")) ilegibles.push(line)
          })) {
            yield* avisos()
            yield* translate(raw, toolNames)
          }
          yield* avisos()
        } catch (e) {
          terminado = true
          yield { type: "error", message: e instanceof Error ? e.message : String(e) }
          return
        }
        terminado = true
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
        // El archivo de config temporal se va con la sesión. Si falla no
        // importa: es un JSON de dos líneas en el directorio temporal.
        if (mcp.path) try { unlinkSync(mcp.path) } catch { /* ya no estaba */ }
      },
    }
  },
}
