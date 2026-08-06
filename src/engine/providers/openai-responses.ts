// Un turno contra la API Responses de OpenAI.
//
// Tercer protocolo, y hace falta por una razón concreta: el plan de coding de
// ChatGPT NO atiende en `/chat/completions`. Atiende en
// `https://chatgpt.com/backend-api/codex/responses`, que es la superficie que
// usa Codex, y ahí el formato es otro:
//
//   · el prompt de sistema es `instructions`, un campo aparte;
//   · el historial es `input[]`, una lista de ÍTEMS —mensajes, llamadas a tool,
//     resultados— y no de mensajes con roles;
//   · las tools se declaran planas (`{type:"function", name, parameters}`), sin
//     el nivel `function` de OpenAI;
//   · el streaming son eventos con nombre (`response.output_text.delta`), no
//     deltas de `choices`.
//
// La trampa de este protocolo es la misma forma que la de Anthropic y aparece
// en el mismo momento —la segunda vuelta—: con `store: false`, que es lo que
// corresponde para no dejar la conversación en el servidor de nadie, los ítems
// de razonamiento hay que DEVOLVERLOS con su `encrypted_content`. Por eso se
// pide `include: ["reasoning.encrypted_content"]` y por eso se guardan los
// ítems crudos, igual que los bloques firmados de Anthropic.
import type { Mensaje, ProviderConfig, ToolCallHecha, ToolSpec, Trozo, Turno } from "./openai-compat.ts"

/** Ítems crudos de la respuesta, para poder devolverlos intactos. */
export type ItemsCrudos = unknown[]

/**
 * Traduce el historial a la lista de ítems que espera Responses.
 *
 * Exportado para poder testearlo sin red: es donde vive la diferencia de forma
 * con los otros dos protocolos.
 */
export function traducir(mensajes: Mensaje[]): { instructions: string; input: unknown[] } {
  const instructions = mensajes.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
  const input: any[] = []

  for (const m of mensajes) {
    if (m.role === "system") continue

    if (m.role === "user") {
      input.push({ type: "message", role: "user", content: [{ type: "input_text", text: m.content }] })
      continue
    }

    if (m.role === "tool") {
      // El resultado es un ítem suelto de la lista, no un mensaje: acá NO hay
      // que agruparlos como en Anthropic.
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content })
      continue
    }

    if (m.role === "assistant") {
      // Si guardamos los ítems crudos —porque traían razonamiento cifrado— se
      // devuelven tal cual, que es la única forma de que la vuelta siguiente no
      // se caiga con `store: false`.
      if (m.bloques?.length) {
        input.push(...m.bloques)
        continue
      }
      if (m.content) {
        input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: m.content }] })
      }
      for (const c of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: c.id,
          name: c.function.name,
          arguments: c.function.arguments || "{}",
        })
      }
    }
  }

  return { instructions, input }
}

/** Corre un turno y va emitiendo lo que llega. */
export async function* turno(
  cfg: ProviderConfig,
  mensajes: Mensaje[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<Trozo, Turno & { bloques: ItemsCrudos }> {
  const { instructions, input } = traducir(mensajes)
  // La URL del plan de ChatGPT ya ES el endpoint completo; la de la plataforma
  // es una base a la que hay que agregarle la ruta.
  const url = cfg.baseUrl.includes("/responses")
    ? cfg.baseUrl
    : `${cfg.baseUrl.replace(/\/$/, "")}/responses`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
      ...cfg.headers,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      ...(instructions ? { instructions } : {}),
      input,
      stream: true,
      // No dejamos la conversación guardada en el servidor. El precio de eso es
      // tener que devolver el razonamiento cifrado nosotros, que es lo que pide
      // el `include` de abajo.
      store: false,
      include: ["reasoning.encrypted_content"],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: false,
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

  const bloques: any[] = []
  const calls: ToolCallHecha[] = []
  let texto = ""
  let entrada = 0
  let salida = 0
  let motivo: Turno["motivo"] = "otro"

  for await (const dato of sse(res.body)) {
    if (dato === "[DONE]") break
    let ev: any
    try {
      ev = JSON.parse(dato)
    } catch {
      continue
    }

    switch (ev.type) {
      case "response.output_text.delta":
        texto += ev.delta ?? ""
        yield { tipo: "texto", delta: String(ev.delta ?? "") }
        break

      // El resumen del razonamiento es lo único legible: el razonamiento en sí
      // viene cifrado y no es para nosotros.
      case "response.reasoning_summary_text.delta":
        yield { tipo: "razonando", delta: String(ev.delta ?? "") }
        break

      case "response.output_item.done": {
        const item = ev.item
        if (!item) break
        // Se guarda TODO ítem terminado, incluido el de razonamiento: es lo que
        // hay que devolver con su `encrypted_content` en la vuelta siguiente.
        bloques.push(item)
        if (item.type === "function_call") {
          const call: ToolCallHecha = {
            id: String(item.call_id ?? item.id ?? `call_${calls.length}`),
            type: "function",
            function: { name: String(item.name ?? ""), arguments: String(item.arguments || "{}") },
          }
          try {
            JSON.parse(call.function.arguments)
          } catch {
            throw new Error(
              `el modelo mandó argumentos ilegibles para ${call.function.name}: ` +
              call.function.arguments.slice(0, 160))
          }
          calls.push(call)
          yield { tipo: "tool", call }
        }
        break
      }

      case "response.completed":
      case "response.incomplete": {
        const u = ev.response?.usage
        entrada = Number(u?.input_tokens ?? entrada)
        salida = Number(u?.output_tokens ?? salida)
        motivo = ev.type === "response.incomplete" ? "length" : "stop"
        break
      }

      case "response.failed":
      case "error":
        throw new Error(String(ev.response?.error?.message ?? ev.message ?? "la API cortó el turno"))
    }
  }

  if (entrada || salida) yield { tipo: "uso", entrada, salida }
  if (calls.length) motivo = "tool_calls"

  return {
    motivo,
    texto,
    calls,
    bloques,
    ...(entrada || salida ? { uso: { entrada, salida } } : {}),
  }
}

/** Igual que en los otros dos protocolos: los chunks no respetan los eventos. */
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
