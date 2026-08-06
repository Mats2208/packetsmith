// Los proveedores, y CÓMO se entra a cada uno.
//
// La versión anterior de esta tabla tenía una fila por endpoint, y eso mentía:
// `kimi` y `moonshot` aparecían como dos proveedores distintos cuando son la
// misma empresa con dos formas de cobrar. Elegir entre ellos en `/engine` es
// elegir un plan, no un proveedor.
//
// Así que la tabla tiene dos niveles, que es como lo modela opencode:
//
//   · un PROVEEDOR es quien te atiende — Kimi, OpenAI, Z.AI;
//   · un PLAN es por dónde entrás y cómo pagás — la suscripción de coding, la
//     API por token, el plan de ChatGPT. Cambia la URL, el protocolo, los
//     modelos, el precio y hasta la forma de autenticarse.
//
// Todo lo que varía vive en el plan. El proveedor es solo el nombre bajo el que
// se agrupan, porque es como los piensa quien los usa.
//
// Los modelos de acá son el punto de partida, no la verdad: al conectarse se le
// pregunta la lista a la API y si contesta, gana la suya. Misma idea que con las
// tools del MCP — preguntar en vez de hardcodear.
import type { Medida } from "./usage.ts"
import { usoChatGPT, usoDeepSeek, usoKimiCode, usoOpenRouter } from "./usage.ts"
import { modelosDe, proveedoresCrudos } from "./models-dev.ts"

/** Qué dialecto habla el endpoint. Ver AGENTS.md: no son variantes de uno solo. */
export type Protocolo = "openai" | "anthropic" | "responses"

/** Credencial ya resuelta, tal como la guarda `auth.ts`. */
export interface Credencial {
  /** Key pegada a mano, o token de acceso de un login. */
  token: string
  /** Cuenta asociada, cuando el plan la necesita como cabecera. */
  accountId?: string
}

export interface Plan {
  /** Id corto. Es lo que queda escrito en `auth.json`. */
  id: string
  label: string
  baseUrl: string
  /** Por defecto el de OpenAI. */
  protocolo?: Protocolo
  /** Variables de entorno aceptadas, en orden de prioridad. */
  env: string[]
  /** Dónde se saca la key o se administra el plan, para poder decirlo. */
  consola: string
  /**
   * Su id en models.dev, de donde sale la lista de modelos DE VERDAD.
   *
   * Una lista escrita a mano envejece sola: la de este repo ofrecía `glm-4.6`
   * cuando ya iban por `glm-5.2`. Acá se pregunta, igual que las tools del MCP.
   */
  modelsDev?: string
  /** Respaldo para cuando no hay copia de models.dev ni red. */
  modelos: string[]
  porDefecto: string
  contextWindow: number
  /**
   * USD por millón de tokens. Ausente = suscripción.
   *
   * No es un dato cosmético: sin precio no hay nada que contar, y el contador
   * de la barra se esconde en vez de marcar `$0.0000` toda la sesión.
   */
  precio?: { entrada: number; salida: number }
  headers?: Record<string, string>
  /**
   * Cómo se entra. `key` = pegás una; `chatgpt` = login de dispositivo.
   *
   * Una suscripción de ChatGPT no TIENE key, tiene sesión. Sin esto, `/connect`
   * te pediría algo que no existe.
   */
  auth?: "key" | "chatgpt"
  /** Si `GET /models` no existe. Los planes de suscripción no suelen tenerlo. */
  sinListaDeModelos?: boolean
  /**
   * De dónde sale el medidor de consumo, si el plan publica uno.
   *
   * Una suscripción sin medidor es una caja negra: no hay precio por token que
   * contar, así que sin esto no hay forma de saber cuánto queda hasta que se
   * corta. Devuelve `undefined` si el endpoint no contesta — el medidor se
   * apaga, la app sigue.
   */
  medidor?: (cred: Credencial) => Promise<Medida | undefined>
}

export interface Provider {
  /** Id corto. Es el nombre del motor y la clave en `auth.json`. */
  id: string
  /** Cómo se llama de verdad, para mostrarlo. */
  label: string
  /** Las formas de entrar. La primera es la que se ofrece primero. */
  planes: Plan[]
}

export const PROVIDERS: Provider[] = [
  {
    id: "kimi",
    label: "Kimi · Moonshot AI",
    planes: [
      {
        // Las keys de este plan empiezan con `sk-kimi-` y NO sirven contra la
        // plataforma por token: verificado, esa contesta 401. Son dos productos
        // de la misma empresa, y por eso están acá como dos planes y no como
        // dos proveedores.
        id: "coding",
        label: "Kimi Code · suscripción",
        baseUrl: "https://api.kimi.com/coding",
        protocolo: "anthropic",
        sinListaDeModelos: true,
        env: ["PACKETSMITH_KIMI_KEY", "KIMI_API_KEY"],
        consola: "https://www.kimi.com/code",
        modelsDev: "kimi-for-coding",
        modelos: ["k3", "k3-256k", "kimi-for-coding"],
        porDefecto: "k3",
        contextWindow: 1_048_576,
        medidor: usoKimiCode,
      },
      {
        id: "api",
        label: "Open Platform · por token",
        baseUrl: "https://api.moonshot.ai/v1",
        env: ["PACKETSMITH_MOONSHOT_KEY", "MOONSHOT_API_KEY"],
        consola: "https://platform.moonshot.ai/console/api-keys",
        modelsDev: "moonshotai",
        modelos: ["kimi-k2.5", "kimi-k2-thinking", "kimi-k3"],
        porDefecto: "kimi-k2.5",
        contextWindow: 256_000,
        precio: { entrada: 0.6, salida: 2.5 },
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    planes: [
      {
        // El plan de coding de la suscripción. No hay key que pegar: hay un
        // login que devuelve tokens que vencen, y los pedidos van a la
        // superficie de Codex, que habla Responses y no `/chat/completions`.
        id: "chatgpt",
        label: "ChatGPT Plus/Pro · suscripción",
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        protocolo: "responses",
        auth: "chatgpt",
        sinListaDeModelos: true,
        env: [],
        consola: "https://chatgpt.com/codex/settings/usage",
        modelsDev: "openai",
        modelos: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex"],
        porDefecto: "gpt-5.6",
        contextWindow: 1_050_000,
        // Codex manda `originator` y no pone tope de salida; se lo copia porque
        // es lo que ese endpoint espera ver.
        headers: { originator: "packetsmith" },
        medidor: usoChatGPT,
      },
      {
        id: "api",
        label: "Platform · por token",
        baseUrl: "https://api.openai.com/v1",
        env: ["PACKETSMITH_OPENAI_KEY", "OPENAI_API_KEY"],
        consola: "https://platform.openai.com/api-keys",
        modelsDev: "openai",
        modelos: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
        porDefecto: "gpt-5.6",
        contextWindow: 1_050_000,
      },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    planes: [
      {
        id: "api",
        label: "Platform · por token",
        baseUrl: "https://api.deepseek.com/v1",
        env: ["PACKETSMITH_DEEPSEEK_KEY", "DEEPSEEK_API_KEY"],
        consola: "https://platform.deepseek.com/api_keys",
        modelsDev: "deepseek",
        modelos: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
        porDefecto: "deepseek-v4-pro",
        contextWindow: 128_000,
        precio: { entrada: 0.27, salida: 1.1 },
        medidor: usoDeepSeek,
      },
    ],
  },
  {
    id: "zai",
    label: "Z.AI · GLM",
    planes: [
      {
        id: "coding",
        label: "GLM Coding Plan · suscripción",
        // Misma key de la consola, otra puerta: el plan de coding tiene su
        // propio `/api/coding/paas/v4` donde los modelos no se cobran por
        // token. La URL sale de models.dev (`zai-coding-plan`), no de adivinar.
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        env: ["PACKETSMITH_ZAI_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
        consola: "https://z.ai/manage-apikey/apikey-list",
        modelsDev: "zai-coding-plan",
        modelos: ["glm-5.2", "glm-5.2-highspeed", "glm-4.7"],
        porDefecto: "glm-5.2",
        contextWindow: 1_000_000,
      },
      {
        id: "api",
        label: "Platform · por token",
        baseUrl: "https://api.z.ai/api/paas/v4",
        env: ["PACKETSMITH_ZAI_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
        consola: "https://z.ai/manage-apikey/apikey-list",
        modelsDev: "zai",
        modelos: ["glm-5.2", "glm-5", "glm-4.7"],
        porDefecto: "glm-5.2",
        contextWindow: 1_000_000,
      },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    planes: [
      {
        id: "api",
        label: "Platform · por token",
        baseUrl: "https://api.groq.com/openai/v1",
        env: ["PACKETSMITH_GROQ_KEY", "GROQ_API_KEY"],
        consola: "https://console.groq.com/keys",
        modelsDev: "groq",
        modelos: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "llama-3.3-70b-versatile"],
        porDefecto: "openai/gpt-oss-120b",
        contextWindow: 131_072,
      },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    planes: [
      {
        id: "api",
        label: "Créditos",
        baseUrl: "https://openrouter.ai/api/v1",
        env: ["PACKETSMITH_OPENROUTER_KEY", "OPENROUTER_API_KEY"],
        consola: "https://openrouter.ai/keys",
        modelsDev: "openrouter",
        modelos: ["moonshotai/kimi-k2.5", "z-ai/glm-5.2", "deepseek/deepseek-v4-pro"],
        porDefecto: "moonshotai/kimi-k2.5",
        contextWindow: 200_000,
        // OpenRouter las pide para atribuir el uso. No son opcionales de
        // verdad: sin ellas la request pasa, pero quedás fuera de sus rankings
        // y de la cuota gratuita de algunos modelos.
        headers: {
          "HTTP-Referer": "https://github.com/Mats2208/packetsmith",
          "X-Title": "PacketSmith",
        },
        medidor: usoOpenRouter,
      },
    ],
  },
]

/**
 * Los modelos que ofrece un plan, lo nuevo primero.
 *
 * models.dev manda; la lista del plan es el respaldo de cuando no hay copia
 * todavía ni red para bajarla.
 */
export function modelosDelPlan(plan: Plan): string[] {
  const vivos = plan.modelsDev ? modelosDe(plan.modelsDev).map((m) => m.id) : []
  return vivos.length ? vivos : plan.modelos
}

/**
 * Los SDK cuyo protocolo sabemos hablar.
 *
 * Un proveedor de models.dev que use `@ai-sdk/amazon-bedrock` o
 * `@ai-sdk/google-vertex` habla algo que este repo no implementa: ofrecerlo en
 * `/engine` sería ofrecer algo que falla al primer mensaje. Se descartan a
 * propósito, y por eso esto es una lista blanca y no una negra.
 */
const SDK_QUE_HABLAMOS = new Set([
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/cerebras",
  "@ai-sdk/deepinfra",
  "@ai-sdk/togetherai",
  "@ai-sdk/xai",
  "@ai-sdk/perplexity",
])

/**
 * Todo lo que se puede elegir: los curados, más los que trae models.dev.
 *
 * Los curados van primero y ganan por id. Tienen lo que un catálogo genérico no
 * puede saber: qué planes existen, cuál habla otro protocolo, y de dónde sale
 * su medidor de consumo. Los descubiertos son un plan y nada más — key, URL y
 * modelos— y eso alcanza para hablarles.
 *
 * Se descubren en vez de escribirse por lo mismo que los modelos: una lista de
 * proveedores escrita a mano tiene seis cuando hay ciento ochenta, y envejece.
 */
/**
 * Memoria de `todosLosProveedores`.
 *
 * Recorrer los ciento ochenta de models.dev no es caro, pero `findProvider` lo
 * llama `auth.ts` en cada lectura de credencial, y eso sí pasa seguido. Se
 * calcula una vez por proceso: el registro de motores se arma al importar, así
 * que descubrir uno nuevo a mitad de sesión no cambiaría nada igual.
 */
let memoria: Provider[] | undefined

export function todosLosProveedores(): Provider[] {
  if (memoria) return memoria
  memoria = construirProveedores()
  return memoria
}

function construirProveedores(): Provider[] {
  const curados = new Set(PROVIDERS.map((p) => p.id))
  // Los alias de un mismo proveedor curado —`moonshotai` es el plan `api` de
  // Kimi— no vuelven a aparecer sueltos.
  const yaCubiertos = new Set(PROVIDERS.flatMap((p) => p.planes.map((x) => x.modelsDev ?? "")))

  const descubiertos: Provider[] = []
  for (const c of proveedoresCrudos()) {
    const id = c.id!
    if (curados.has(id) || yaCubiertos.has(id)) continue
    // Sin URL no hay a dónde hablar, y sin variable no hay de dónde sacar la
    // key. Los dos son datos del proveedor, no cosas que podamos inventar.
    if (!c.api || !c.api.startsWith("https://") || !c.env?.length) continue
    if (c.npm && !SDK_QUE_HABLAMOS.has(c.npm)) continue

    const modelos = modelosDe(id)
    // Sin un modelo que llame tools no puede manejar Packet Tracer.
    if (!modelos.length) continue

    descubiertos.push({
      id,
      label: c.name ?? id,
      planes: [{
        id: "api",
        label: c.name ?? id,
        baseUrl: c.api,
        protocolo: c.npm === "@ai-sdk/anthropic" ? "anthropic" : "openai",
        env: [`PACKETSMITH_${id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_KEY`, ...c.env],
        consola: c.api,
        modelsDev: id,
        modelos: modelos.slice(0, 6).map((m) => m.id),
        porDefecto: modelos[0]!.id,
        contextWindow: modelos[0]!.contextWindow ?? 128_000,
        ...(modelos[0]!.precio ? { precio: modelos[0]!.precio } : {}),
      }],
    })
  }

  descubiertos.sort((a, b) => a.label.localeCompare(b.label))
  return [...PROVIDERS, ...descubiertos]
}

export function findProvider(id: string): Provider | undefined {
  return todosLosProveedores().find((p) => p.id === id)
}

/** Un plan concreto. Sin `planId`, el primero — que es el recomendado. */
export function findPlan(providerId: string, planId?: string): Plan | undefined {
  const p = findProvider(providerId)
  if (!p) return undefined
  return (planId && p.planes.find((x) => x.id === planId)) || p.planes[0]
}

/** Todas las variables de entorno que acepta un proveedor, sin repetir. */
export function variablesDe(providerId: string): string[] {
  const p = findProvider(providerId)
  return [...new Set((p?.planes ?? []).flatMap((x) => x.env))]
}

/**
 * Le pregunta a la API qué modelos tiene.
 *
 * Vacío si no contesta o si no implementa el endpoint, y ahí manda la lista de
 * la tabla. Se filtra lo que claramente no sirve para chatear —embeddings,
 * whisper, imágenes— porque ofrecerlos en `/model` es ofrecer algo que falla.
 */
export async function modelosDeLaApi(plan: Plan, key: string): Promise<string[]> {
  if (plan.sinListaDeModelos) return []
  try {
    const res = await fetch(`${plan.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${key}`, ...plan.headers },
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
