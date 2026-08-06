// Los proveedores que hablan el dialecto de OpenAI.
//
// Son todos el mismo protocolo: `/chat/completions` con tools y streaming. Lo
// único que cambia entre uno y otro es la URL, de dónde sale la key, y qué
// modelos ofrece. Por eso esto es una TABLA y no seis archivos: agregar un
// proveedor compatible tiene que costar cinco líneas, no un módulo.
//
// Los modelos de acá son el punto de partida, no la verdad. Al conectarse se le
// pregunta la lista a la API —`GET /models`, que casi todos implementan— y si
// contesta, gana la suya. Es la misma idea que con las tools del MCP: preguntar
// en vez de hardcodear, porque los nombres de modelo cambian todo el tiempo y
// una lista escrita a mano envejece sola.

export interface Provider {
  /** Id corto. Es el nombre del motor y la clave en `auth.json`. */
  id: string
  /** Cómo se llama de verdad, para mostrarlo. */
  label: string
  baseUrl: string
  /** Variables de entorno aceptadas, en orden de prioridad. */
  env: string[]
  /** Dónde sacar una key, para poder decirlo cuando falta. */
  consola: string
  /** Punto de partida. La API manda si contesta `GET /models`. */
  modelos: string[]
  /** Con cuál arrancar. */
  porDefecto: string
  /** Ventana de contexto, para el medidor. Aproximada y por familia. */
  contextWindow: number
  /** USD por millón de tokens. Solo para el contador de la barra. */
  precio?: { entrada: number; salida: number }
  /** Cabeceras que pida el proveedor además de la autorización. */
  headers?: Record<string, string>
}

export const PROVIDERS: Provider[] = [
  {
    id: "kimi",
    label: "Kimi · Moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    env: ["PACKETSMITH_KIMI_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY"],
    consola: "https://platform.moonshot.ai/console/api-keys",
    modelos: ["kimi-k2-turbo-preview", "kimi-k2-0905-preview", "moonshot-v1-128k"],
    porDefecto: "kimi-k2-turbo-preview",
    contextWindow: 256_000,
    precio: { entrada: 0.6, salida: 2.5 },
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    env: ["PACKETSMITH_OPENAI_KEY", "OPENAI_API_KEY"],
    consola: "https://platform.openai.com/api-keys",
    modelos: ["gpt-5.2", "gpt-5.2-mini", "gpt-4.1"],
    porDefecto: "gpt-5.2",
    contextWindow: 400_000,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    env: ["PACKETSMITH_DEEPSEEK_KEY", "DEEPSEEK_API_KEY"],
    consola: "https://platform.deepseek.com/api_keys",
    modelos: ["deepseek-chat", "deepseek-reasoner"],
    porDefecto: "deepseek-chat",
    contextWindow: 128_000,
    precio: { entrada: 0.27, salida: 1.1 },
  },
  {
    id: "zai",
    label: "Z.AI · GLM",
    baseUrl: "https://api.z.ai/api/paas/v4",
    env: ["PACKETSMITH_ZAI_KEY", "ZAI_API_KEY", "ZHIPUAI_API_KEY"],
    consola: "https://z.ai/manage-apikey/apikey-list",
    modelos: ["glm-4.6", "glm-4.5-air"],
    porDefecto: "glm-4.6",
    contextWindow: 200_000,
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    env: ["PACKETSMITH_GROQ_KEY", "GROQ_API_KEY"],
    consola: "https://console.groq.com/keys",
    modelos: ["moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile"],
    porDefecto: "moonshotai/kimi-k2-instruct",
    contextWindow: 128_000,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    env: ["PACKETSMITH_OPENROUTER_KEY", "OPENROUTER_API_KEY"],
    consola: "https://openrouter.ai/keys",
    modelos: ["moonshotai/kimi-k2", "deepseek/deepseek-chat", "z-ai/glm-4.6"],
    porDefecto: "moonshotai/kimi-k2",
    contextWindow: 200_000,
    // OpenRouter las pide para atribuir el uso. No son opcionales de verdad:
    // sin ellas la request pasa, pero quedás fuera de sus rankings y de la
    // cuota gratuita de algunos modelos.
    headers: {
      "HTTP-Referer": "https://github.com/Mats2208/packetsmith",
      "X-Title": "PacketSmith",
    },
  },
]

export function findProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/**
 * Le pregunta a la API qué modelos tiene.
 *
 * Vacío si no contesta o si no implementa el endpoint, y ahí manda la lista de
 * la tabla. Se filtra lo que claramente no sirve para chatear —embeddings,
 * whisper, imágenes— porque ofrecerlos en `/model` es ofrecer algo que falla.
 */
export async function modelosDeLaApi(p: Provider, key: string): Promise<string[]> {
  try {
    const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${key}`, ...p.headers },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const j = await res.json() as { data?: { id?: string }[] }
    return (j.data ?? [])
      .map((m) => String(m.id ?? ""))
      .filter((id) => id && !/embed|whisper|tts|image|dall|rerank|moderation/i.test(id))
      .sort()
  } catch {
    return []
  }
}
