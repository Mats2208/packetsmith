// Cuánto llevás consumido de cada plan.
//
// Con el CLI de Claude esto ya estaba: el stream trae la ventana y un endpoint
// de Anthropic da el porcentaje. Con un proveedor propio no venía NADA, y en
// una suscripción eso es peor que en una API por token: no hay precio por token
// que contar, así que la barra decía `$0.0000` y no había forma de saber cuánto
// quedaba hasta que el turno se cortaba solo.
//
// Cada plan sabe de dónde sale su número. Son endpoints distintos con formas
// distintas —porcentajes, saldos en dólares, cupos absolutos— y por eso lo que
// devuelven se normaliza acá a UNA forma, que es la que ya sabe dibujar la
// barra de estado.
//
// Regla: si el endpoint no contesta, el medidor se apaga y la app sigue. Un
// medidor es información, no una dependencia.
import type { Credencial } from "./catalog.ts"

export interface Medida {
  /** Nombre de la ventana corta: `5H`, `24H`… Lo dice el proveedor. */
  ventana?: string
  /** Porcentaje USADO de la ventana corta, 0..100. */
  sesion?: number
  /** Porcentaje USADO de la ventana larga, 0..100. */
  semanal?: number
  /** Cuándo se repone la corta. Epoch en segundos. */
  reinicio?: number
  /** Una línea para `/usage` con lo que no entra en un porcentaje. */
  nota?: string
}

const TIMEOUT = 8_000

async function pedir(url: string, cred: Credencial, extra?: Record<string, string>) {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${cred.token}`,
      accept: "application/json",
      ...(cred.accountId ? { "ChatGPT-Account-Id": cred.accountId } : {}),
      ...extra,
    },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Porcentaje usado a partir de un par usado/límite que puede venir como texto. */
function pct(usado: unknown, limite: unknown): number | undefined {
  const u = Number(usado)
  const l = Number(limite)
  if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return undefined
  return Math.min(100, Math.max(0, (u / l) * 100))
}

/** `300` minutos → `5H`. Lo que el proveedor llama ventana, en una etiqueta. */
export function etiquetaDeVentana(duracion: number, unidad: string): string | undefined {
  const min = unidad === "TIME_UNIT_MINUTE" ? duracion
    : unidad === "TIME_UNIT_HOUR" ? duracion * 60
    : unidad === "TIME_UNIT_DAY" ? duracion * 1440
    : undefined
  if (!min) return undefined
  if (min % 1440 === 0) return `${min / 1440}D`
  if (min % 60 === 0) return `${min / 60}H`
  return `${min}M`
}

function epoch(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.round(t / 1000) : undefined
}

/**
 * Kimi Code. Verificado contra la API real.
 *
 * `usage` es la ventana larga y `limits[0]` la corta, con su duración declarada
 * en vez de asumida — la del plan probado son 300 minutos, o sea 5H, pero eso
 * lo dice la respuesta y no nosotros.
 */
export async function usoKimiCode(cred: Credencial): Promise<Medida | undefined> {
  try {
    const j = await pedir("https://api.kimi.com/coding/v1/usages", cred) as {
      usage?: { limit?: string; used?: string; resetTime?: string }
      limits?: { window?: { duration?: number; timeUnit?: string }
                 detail?: { limit?: string; used?: string; resetTime?: string } }[]
      parallel?: { limit?: string }
    }
    const corta = j.limits?.[0]
    const medida: Medida = {
      ...(corta?.window?.duration && corta.window.timeUnit
        ? { ventana: etiquetaDeVentana(corta.window.duration, corta.window.timeUnit) }
        : {}),
      sesion: pct(corta?.detail?.used, corta?.detail?.limit),
      semanal: pct(j.usage?.used, j.usage?.limit),
      reinicio: epoch(corta?.detail?.resetTime),
    }
    if (j.parallel?.limit) medida.nota = `hasta ${j.parallel.limit} pedidos en paralelo`
    return medida
  } catch {
    return undefined
  }
}

/**
 * ChatGPT Pro/Plus, el plan de coding.
 *
 * Dos ventanas con el porcentaje ya calculado, que es lo más cómodo de todos.
 * Pide la cabecera de cuenta, y por eso `Credencial` la lleva.
 */
export async function usoChatGPT(cred: Credencial): Promise<Medida | undefined> {
  try {
    const j = await pedir("https://chatgpt.com/backend-api/wham/usage", cred) as {
      plan_type?: string
      rate_limit?: {
        primary_window?: { used_percent?: number; resets_at?: number; limit_window_seconds?: number }
        secondary_window?: { used_percent?: number; resets_at?: number }
      }
    }
    const p = j.rate_limit?.primary_window
    const s = j.rate_limit?.secondary_window
    const segundos = p?.limit_window_seconds
    return {
      ...(segundos ? { ventana: etiquetaDeVentana(Math.round(segundos / 60), "TIME_UNIT_MINUTE") } : {}),
      sesion: typeof p?.used_percent === "number" ? p.used_percent : undefined,
      semanal: typeof s?.used_percent === "number" ? s.used_percent : undefined,
      reinicio: p?.resets_at,
      ...(j.plan_type ? { nota: `plan ${j.plan_type}` } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * OpenRouter. No hay ventanas: hay saldo.
 *
 * Se informa como nota y no como barra a propósito — una barra de "cuánto
 * gastaste del total que cargaste alguna vez" no dice nada útil.
 */
export async function usoOpenRouter(cred: Credencial): Promise<Medida | undefined> {
  try {
    const j = await pedir("https://openrouter.ai/api/v1/credits", cred) as {
      data?: { total_credits?: number; total_usage?: number }
    }
    const total = j.data?.total_credits
    const usado = j.data?.total_usage
    if (typeof total !== "number" || typeof usado !== "number") return undefined
    return { nota: `saldo $${(total - usado).toFixed(2)} de $${total.toFixed(2)}` }
  } catch {
    return undefined
  }
}

/** DeepSeek. También saldo, en la moneda que informe la cuenta. */
export async function usoDeepSeek(cred: Credencial): Promise<Medida | undefined> {
  try {
    const j = await pedir("https://api.deepseek.com/user/balance", cred) as {
      is_available?: boolean
      balance_infos?: { currency?: string; total_balance?: string }[]
    }
    const b = j.balance_infos?.[0]
    if (!b?.total_balance) return undefined
    return {
      nota: `saldo ${b.total_balance} ${b.currency ?? ""}`.trim() +
        (j.is_available === false ? " — sin crédito" : ""),
    }
  } catch {
    return undefined
  }
}
