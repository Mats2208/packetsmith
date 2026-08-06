// Un turno de chat contra cualquier API compatible con OpenAI, en streaming.
//
// Sirve para Kimi (Moonshot), DeepSeek, GLM, OpenRouter, Together y el propio
// OpenAI: todos hablan `/chat/completions` con el mismo esquema. Lo único que
// cambia entre ellos es la URL base y de dónde sale la key.
//
// Tres cosas se aprendieron leyendo cómo lo resuelve opencode, y las tres son
// las que rompen una implementación ingenua:
//
//   · Los argumentos de una tool NO llegan enteros. Vienen partidos entre
//     muchos deltas y hay que acumularlos por ÍNDICE —no por id, que puede
//     faltar en los deltas del medio— como texto crudo, y recién parsearlos al
//     cierre. Parsear antes revienta con un JSON a medias.
//   · El razonamiento viaja en `reasoning_content`, un campo aparte de
//     `content`. Los modelos que piensan mandan casi todo por ahí, y si no se
//     lo mira parece que el modelo está colgado.
//   · El uso de tokens solo llega si se pide `stream_options.include_usage`, y
//     viene en un chunk final que no tiene `choices`.

/** Una tool ofrecida al modelo, en el formato que espera la API. */
export interface ToolSpec {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export type Mensaje =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant"
      content: string
      tool_calls?: ToolCallHecha[]
      /**
       * Los bloques tal como los mandó el proveedor.
       *
       * Solo lo usa el protocolo de Anthropic: con razonamiento extendido hay
       * que devolverlos INTACTOS, con su firma, o el pedido siguiente da 400.
       */
      bloques?: unknown[]
    }
  | { role: "tool"; tool_call_id: string; content: string }

export interface ToolCallHecha {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

/** Lo que va saliendo del turno, según llega. */
export type Trozo =
  | { tipo: "texto"; delta: string }
  | { tipo: "razonando"; delta: string }
  /** Una tool quedó completa y lista para ejecutar. */
  | { tipo: "tool"; call: ToolCallHecha }
  | { tipo: "uso"; entrada: number; salida: number }

export interface Turno {
  /** `stop` = contestó; `tool_calls` = quiere ejecutar algo y seguir. */
  motivo: "stop" | "tool_calls" | "length" | "otro"
  texto: string
  calls: ToolCallHecha[]
  uso?: { entrada: number; salida: number }
}

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Cabeceras extra que pida el proveedor. */
  headers?: Record<string, string>
  /** Se mezcla en el cuerpo. Acá viven las variantes de esfuerzo. */
  body?: Record<string, unknown>
}

/** Acumulador de una tool que todavía se está transmitiendo. */
interface Parcial {
  id: string
  name: string
  /** JSON crudo tal como viene, sin parsear. */
  args: string
}

/**
 * Corre un turno y va emitiendo lo que llega.
 *
 * Devuelve el resumen al terminar: hace falta para decidir si el bucle sigue
 * (hay tools que ejecutar) o cierra.
 */
export async function* turno(
  cfg: ProviderConfig,
  mensajes: Mensaje[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<Trozo, Turno> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
      ...cfg.headers,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages: mensajes,
      stream: true,
      // Sin esto no llega el conteo de tokens y el medidor de contexto miente.
      stream_options: { include_usage: true },
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...cfg.body,
    }),
  })

  if (!res.ok || !res.body) {
    const detalle = await res.text().catch(() => "")
    throw new Error(`${res.status} ${res.statusText}${detalle ? ` — ${detalle.slice(0, 300)}` : ""}`)
  }

  const parciales = new Map<number, Parcial>()
  let texto = ""
  let motivo: Turno["motivo"] = "otro"
  let uso: Turno["uso"]

  for await (const dato of sse(res.body)) {
    if (dato === "[DONE]") break

    let ev: any
    try {
      ev = JSON.parse(dato)
    } catch {
      // Una línea rota no tiene por qué matar el turno, pero tampoco se traga
      // en silencio: es la regla de la casa.
      yield { tipo: "razonando", delta: "" }
      continue
    }

    // El chunk del uso viene al final y NO trae `choices`.
    if (ev.usage) {
      uso = {
        entrada: Number(ev.usage.prompt_tokens ?? 0),
        salida: Number(ev.usage.completion_tokens ?? 0),
      }
      yield { tipo: "uso", ...uso }
    }

    const choice = ev.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) motivo = mapearMotivo(choice.finish_reason)

    const delta = choice.delta
    if (!delta) continue

    // El razonamiento va por su propio canal. Los modelos que piensan mandan
    // casi todo por acá antes de la primera letra de la respuesta.
    if (delta.reasoning_content) yield { tipo: "razonando", delta: String(delta.reasoning_content) }
    if (delta.content) {
      texto += delta.content
      yield { tipo: "texto", delta: String(delta.content) }
    }

    for (const td of delta.tool_calls ?? []) {
      // La clave es el ÍNDICE y no el id: los deltas del medio suelen traer
      // solo el índice y un pedazo de los argumentos.
      const i = Number(td.index ?? 0)
      const p = parciales.get(i) ?? { id: "", name: "", args: "" }
      if (td.id) p.id = String(td.id)
      if (td.function?.name) p.name += String(td.function.name)
      if (td.function?.arguments) p.args += String(td.function.arguments)
      parciales.set(i, p)
    }
  }

  // Recién acá se parsea: antes el JSON está a medias por definición.
  const calls: ToolCallHecha[] = []
  for (const [i, p] of [...parciales].sort((a, b) => a[0] - b[0])) {
    if (!p.name) continue
    // Un id vacío pasa con algunos proveedores; el bucle necesita uno para
    // emparejar el resultado, así que se inventa uno estable.
    const id = p.id || `call_${i}`
    // El argumento vacío es legítimo: una tool sin parámetros.
    const args = p.args.trim() || "{}"
    try {
      JSON.parse(args)
    } catch {
      throw new Error(`el modelo mandó argumentos ilegibles para ${p.name}: ${args.slice(0, 160)}`)
    }
    calls.push({ id, type: "function", function: { name: p.name, arguments: args } })
    yield { tipo: "tool", call: calls[calls.length - 1]! }
  }

  // Algunos proveedores cierran con `stop` aunque hayan pedido tools.
  if (calls.length && motivo !== "tool_calls") motivo = "tool_calls"

  return { motivo, texto, calls, ...(uso ? { uso } : {}) }
}

function mapearMotivo(r: string): Turno["motivo"] {
  if (r === "tool_calls" || r === "function_call") return "tool_calls"
  if (r === "stop" || r === "end_turn") return "stop"
  if (r === "length" || r === "max_tokens") return "length"
  return "otro"
}

/**
 * Parte un stream SSE en los `data:` que trae.
 *
 * Se escribe a mano por lo mismo que el resto: son veinte líneas y una
 * dependencia costaría más. El corte de los chunks no respeta los eventos, así
 * que hay buffer — el mismo problema que ya tiene `stream.ts` con NDJSON.
 */
async function* sse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let corte: number
    while ((corte = buffer.indexOf("\n")) !== -1) {
      const linea = buffer.slice(0, corte).trim()
      buffer = buffer.slice(corte + 1)
      if (linea.startsWith("data:")) yield linea.slice(5).trim()
    }
  }
  const resto = buffer.trim()
  if (resto.startsWith("data:")) yield resto.slice(5).trim()
}
