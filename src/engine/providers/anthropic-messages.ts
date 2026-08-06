// Un turno contra una API que habla el protocolo de Anthropic Messages.
//
// Hace falta porque no todos los proveedores hablan el dialecto de OpenAI. Los
// planes de suscripción de coding —Kimi Code entre ellos— exponen la superficie
// de Anthropic, que es otra cosa: `system` es un campo aparte y no un mensaje,
// las tools declaran `input_schema` en vez de `function.parameters`, y el
// streaming va por bloques con eventos propios en vez de deltas de `choices`.
//
// Se acepta la MISMA lista de mensajes que el provider de OpenAI y se traduce
// acá adentro, así el bucle de agente no sabe con cuál de los dos está hablando.
//
// Dos trampas de este protocolo, y las dos rompen recién en la segunda vuelta:
//
//   · Los resultados de tools van TODOS en un solo mensaje de usuario. Mandados
//     de a uno, la API rechaza el pedido siguiente.
//   · Con razonamiento extendido —Kimi K3 piensa por defecto— hay que devolver
//     los bloques `thinking` TAL CUAL vinieron, con su firma. Reconstruir el
//     mensaje del asistente solo con el texto y las tools da un 400.
import type { Mensaje, ProviderConfig, ToolCallHecha, ToolSpec, Trozo, Turno } from "./openai-compat.ts"

/** Bloques crudos del asistente, para poder devolverlos intactos. */
export type BloquesCrudos = unknown[]

interface Parcial {
  id: string
  name: string
  args: string
}

/**
 * Arma el cuerpo que espera la API.
 *
 * Exportado para poder testear la traducción sin red: es donde viven las dos
 * trampas, y son las que no se ven hasta la segunda vuelta del bucle.
 */
export function traducir(mensajes: Mensaje[]): { system: string; messages: unknown[] } {
  const system = mensajes.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
  const messages: any[] = []

  for (const m of mensajes) {
    if (m.role === "system") continue

    if (m.role === "tool") {
      // Los resultados se ACUMULAN en el último mensaje de usuario si ese
      // mensaje ya es de resultados. Mandados de a uno, la API rechaza el
      // pedido siguiente.
      const ultimo = messages[messages.length - 1]
      const bloque = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }
      if (ultimo?.role === "user" && Array.isArray(ultimo.content) &&
          ultimo.content[0]?.type === "tool_result") {
        ultimo.content.push(bloque)
      } else {
        messages.push({ role: "user", content: [bloque] })
      }
      continue
    }

    if (m.role === "user") {
      messages.push({ role: "user", content: m.content })
      continue
    }

    if (m.role === "assistant") {
      // Si guardamos los bloques crudos —porque venían con razonamiento
      // firmado— se devuelven tal cual.
      if (m.bloques?.length) {
        messages.push({ role: "assistant", content: m.bloques })
        continue
      }
      const content: any[] = []
      if (m.content) content.push({ type: "text", text: m.content })
      for (const c of m.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: c.id,
          name: c.function.name,
          input: JSON.parse(c.function.arguments || "{}"),
        })
      }
      if (content.length) messages.push({ role: "assistant", content })
    }
  }

  return { system, messages }
}

/** Corre un turno y va emitiendo lo que llega. */
export async function* turno(
  cfg: ProviderConfig,
  mensajes: Mensaje[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<Trozo, Turno & { bloques: BloquesCrudos }> {
  const { system, messages } = traducir(mensajes)

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Los dos: unos aceptan `x-api-key` y otros el bearer de siempre.
      "x-api-key": cfg.apiKey,
      authorization: `Bearer ${cfg.apiKey}`,
      "anthropic-version": "2023-06-01",
      ...cfg.headers,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      // Obligatorio en este protocolo, a diferencia del de OpenAI.
      max_tokens: (cfg.body?.max_tokens as number) ?? 8192,
      ...(system ? { system } : {}),
      messages,
      stream: true,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
      ...Object.fromEntries(Object.entries(cfg.body ?? {}).filter(([k]) => k !== "max_tokens")),
    }),
  })

  if (!res.ok || !res.body) {
    const detalle = await res.text().catch(() => "")
    throw new Error(`${res.status} ${res.statusText}${detalle ? ` — ${detalle.slice(0, 300)}` : ""}`)
  }

  const parciales = new Map<number, Parcial>()
  /** Los bloques tal como vinieron, para poder devolverlos con su firma. */
  const bloques: any[] = []
  let texto = ""
  let motivo: Turno["motivo"] = "otro"
  let entrada = 0
  let salida = 0

  for await (const dato of sse(res.body)) {
    let ev: any
    try {
      ev = JSON.parse(dato)
    } catch {
      continue
    }

    switch (ev.type) {
      case "message_start": {
        // Lo cacheado CUENTA para la ventana aunque no se cobre igual. Sumar
        // solo `input_tokens` haría que el medidor de contexto marque 250 con
        // el prompt de sistema y 61 tools adentro — o sea, que mienta.
        const u = ev.message?.usage ?? {}
        entrada = Number(u.input_tokens ?? 0) +
          Number(u.cache_read_input_tokens ?? 0) +
          Number(u.cache_creation_input_tokens ?? 0)
        break
      }

      case "content_block_start": {
        const i = Number(ev.index ?? 0)
        const b = ev.content_block
        bloques[i] = structuredClone(b)
        if (b?.type === "tool_use") {
          parciales.set(i, { id: String(b.id ?? `call_${i}`), name: String(b.name ?? ""), args: "" })
        }
        if (b?.type === "thinking") bloques[i].thinking = b.thinking ?? ""
        if (b?.type === "text") bloques[i].text = b.text ?? ""
        break
      }

      case "content_block_delta": {
        const i = Number(ev.index ?? 0)
        const d = ev.delta
        if (d?.type === "text_delta") {
          texto += d.text
          if (bloques[i]) bloques[i].text = (bloques[i].text ?? "") + d.text
          yield { tipo: "texto", delta: String(d.text) }
        }
        if (d?.type === "thinking_delta") {
          if (bloques[i]) bloques[i].thinking = (bloques[i].thinking ?? "") + d.thinking
          yield { tipo: "razonando", delta: String(d.thinking ?? "") }
        }
        // La firma del razonamiento llega en su propio delta y hay que
        // conservarla: sin ella, devolver el bloque da un 400.
        if (d?.type === "signature_delta" && bloques[i]) {
          bloques[i].signature = (bloques[i].signature ?? "") + d.signature
        }
        if (d?.type === "input_json_delta") {
          const p = parciales.get(i)
          if (p) p.args += String(d.partial_json ?? "")
        }
        break
      }

      case "content_block_stop": {
        const i = Number(ev.index ?? 0)
        const p = parciales.get(i)
        if (!p) break
        const args = p.args.trim() || "{}"
        try {
          if (bloques[i]) bloques[i].input = JSON.parse(args)
        } catch {
          throw new Error(`el modelo mandó argumentos ilegibles para ${p.name}: ${args.slice(0, 160)}`)
        }
        break
      }

      case "message_delta":
        if (ev.delta?.stop_reason) motivo = mapearMotivo(String(ev.delta.stop_reason))
        salida = Number(ev.usage?.output_tokens ?? salida)
        break
    }
  }

  const calls: ToolCallHecha[] = []
  for (const [i, p] of [...parciales].sort((a, b) => a[0] - b[0])) {
    if (!p.name) continue
    const args = JSON.stringify(bloques[i]?.input ?? {})
    calls.push({ id: p.id, type: "function", function: { name: p.name, arguments: args } })
    yield { tipo: "tool", call: calls[calls.length - 1]! }
  }

  if (entrada || salida) yield { tipo: "uso", entrada, salida }
  if (calls.length && motivo !== "tool_calls") motivo = "tool_calls"

  return {
    motivo,
    texto,
    calls,
    bloques: bloques.filter(Boolean),
    ...(entrada || salida ? { uso: { entrada, salida } } : {}),
  }
}

function mapearMotivo(r: string): Turno["motivo"] {
  if (r === "tool_use") return "tool_calls"
  if (r === "end_turn" || r === "stop_sequence") return "stop"
  if (r === "max_tokens") return "length"
  return "otro"
}

/** Igual que en el otro protocolo: los chunks no respetan los eventos. */
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
