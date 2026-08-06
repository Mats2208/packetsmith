// Qué modelos existen hoy, preguntado en vez de escrito a mano.
//
// Una lista de modelos escrita en el código nace vieja. La de este repo decía
// `glm-4.6` cuando ya iban por `glm-5.2`, y no porque nadie la mirara: es que
// envejece sola, en silencio, y el único síntoma es que ofrecés algo peor de lo
// que el proveedor tiene.
//
// La misma regla que con las tools del MCP: PREGUNTAR. models.dev publica el
// catálogo de 180 proveedores —id, contexto, precio, si llama tools, cuándo
// salió— y es de donde lo saca opencode. Nosotros hacemos lo mismo, más chico:
//
//   · se lee del disco primero, así arrancar no espera a la red;
//   · si la copia está vieja se refresca EN SEGUNDO PLANO, y el dato nuevo
//     entra en el próximo `/model`;
//   · si no hay red ni copia, manda la lista mínima del catálogo.
//
// Se filtra por `tool_call`: un modelo que no llama tools no puede manejar
// Packet Tracer, y ofrecerlo en `/model` es ofrecer algo que falla.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const FUENTE = process.env.PACKETSMITH_MODELS_URL || "https://models.dev/api.json"
export const CACHE_PATH = join(homedir(), ".packetsmith", "models.json")

/** Cuánto vale la copia del disco antes de volver a preguntar. */
const TTL_MS = 12 * 60 * 60 * 1000

export interface ModeloInfo {
  id: string
  nombre: string
  /** Ventana de contexto, para el medidor. */
  contextWindow?: number
  /** USD por millón. Cero en los planes de suscripción, y eso es un dato. */
  precio?: { entrada: number; salida: number }
  razona: boolean
  /** Fecha de salida, para ordenar lo nuevo primero. */
  release: string
}

export interface ProveedorCrudo {
  id?: string
  name?: string
  /** URL base de la API. Sin esto no hay a dónde hablarle. */
  api?: string
  /** Variables de entorno que ese proveedor documenta. */
  env?: string[]
  /** Qué SDK usa opencode. Nos dice si habla un protocolo que sabemos. */
  npm?: string
}

interface Crudo extends ProveedorCrudo {
  models?: Record<string, {
    id?: string
    name?: string
    tool_call?: boolean
    reasoning?: boolean
    release_date?: string
    limit?: { context?: number }
    cost?: { input?: number; output?: number }
  }>
}

/** La copia en memoria. Se llena en la primera lectura del disco. */
let cache: Record<string, Crudo> | undefined
let refrescando = false

function leerDisco(): Record<string, Crudo> | undefined {
  try {
    const j = JSON.parse(readFileSync(process.env.PACKETSMITH_MODELS_PATH || CACHE_PATH, "utf8"))
    return j && typeof j === "object" ? j : undefined
  } catch {
    return undefined
  }
}

function vencida(): boolean {
  try {
    return Date.now() - statSync(CACHE_PATH).mtimeMs > TTL_MS
  } catch {
    return true
  }
}

/**
 * Baja el catálogo y lo deja en el disco.
 *
 * Escribe a un temporal y renombra: si el proceso muere a mitad de la bajada,
 * la copia vieja sigue entera en vez de quedar un JSON cortado que después no
 * parsea. Es el mismo cuidado que tiene opencode con su caché.
 */
export async function refrescar(): Promise<boolean> {
  try {
    const res = await fetch(FUENTE, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return false
    const texto = await res.text()
    const datos = JSON.parse(texto)
    if (!datos || typeof datos !== "object") return false

    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    const tmp = `${CACHE_PATH}.${process.pid}.tmp`
    writeFileSync(tmp, texto)
    renameSync(tmp, CACHE_PATH)
    cache = datos
    return true
  } catch {
    return false
  }
}

/**
 * Se asegura de tener algo con qué contestar, sin bloquear a nadie.
 *
 * Devuelve enseguida: si hay copia se usa, y si está vencida se pide otra por
 * atrás. Nunca espera a la red — arrancar la app no puede depender de que
 * models.dev esté vivo.
 */
export function asegurarCatalogo(): void {
  if (cache === undefined) cache = leerDisco()
  if (refrescando || !vencida()) return
  refrescando = true
  void refrescar().finally(() => { refrescando = false })
}

/**
 * Los modelos de un proveedor de models.dev, lo nuevo primero.
 *
 * Vacío si no hay copia todavía; ahí manda la lista del catálogo.
 */
export function modelosDe(devId: string): ModeloInfo[] {
  asegurarCatalogo()
  const p = cache?.[devId]
  if (!p?.models) return []

  return Object.values(p.models)
    // Sin tool calling no hay agente. No es un filtro cosmético.
    .filter((m) => m?.tool_call && m.id)
    .map((m) => ({
      id: String(m.id),
      nombre: String(m.name ?? m.id),
      ...(m.limit?.context ? { contextWindow: m.limit.context } : {}),
      ...(m.cost && (m.cost.input || m.cost.output)
        ? { precio: { entrada: m.cost.input ?? 0, salida: m.cost.output ?? 0 } }
        : {}),
      razona: !!m.reasoning,
      release: String(m.release_date ?? ""),
    }))
    .sort((a, b) => b.release.localeCompare(a.release) || a.id.localeCompare(b.id))
}

/**
 * Todos los proveedores del catálogo, con lo que hace falta para hablarles.
 *
 * Es lo que permite ofrecer los ~180 de models.dev en vez de los seis que
 * alguien escribió a mano. Se devuelven crudos: filtrar por protocolo es
 * decisión del catálogo, no de este módulo.
 */
export function proveedoresCrudos(): ProveedorCrudo[] {
  asegurarCatalogo()
  if (!cache) return []
  return Object.entries(cache).map(([id, p]) => ({ ...p, id: p.id ?? id }))
}

/** Lo que se sabe de UN modelo. Para el medidor de contexto y el contador. */
export function infoDeModelo(devId: string, modelo: string): ModeloInfo | undefined {
  return modelosDe(devId).find((m) => m.id === modelo)
}
