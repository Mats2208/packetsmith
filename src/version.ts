// Si salió una versión más nueva que la que estás corriendo.
//
// npm no avisa nada: quien instaló 0.3.1 se queda en 0.3.1 hasta que un día
// entra al repo por otra cosa. Un agente que habla con un CLI y con un MCP es
// exactamente el tipo de programa donde una versión vieja se nota tarde y mal
// —una tool que cambió de nombre, un proveedor que movió su endpoint—, así que
// la app pregunta.
//
// Las reglas son las mismas que con el catálogo de modelos, y por las mismas
// razones (ver `engine/providers/models-dev.ts`):
//
//   · nunca bloquea el arranque — se contesta con el disco y se refresca atrás;
//   · falla ABIERTO y en silencio: sin red, sin registro o con un JSON roto no
//     se avisa nada, que es mejor que un cartel de error por una consulta que
//     nadie pidió;
//   · se apaga entero con PACKETSMITH_NO_UPDATE_CHECK, para quien no quiera que
//     la app hable con la red sin que se lo pidan.
//
// Lo que NO hace, a propósito: actualizarse sola. Reemplazar el binario que
// estás corriendo, sin que lo pidas y mientras hay una sesión con Packet
// Tracer abierta, es una idea peor que quedarse una versión atrás.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, sep } from "node:path"

/**
 * El endpoint más chico que contesta la pregunta: `{"latest":"0.3.1"}`.
 *
 * Es una función y no una constante para que el entorno se lea AL USARLA. Con
 * la constante, el valor quedaba clavado en el import y un test que quisiera
 * apuntar a otro servidor tenía que hacer malabares para invalidar la caché de
 * módulos. Es la misma forma en que `models-dev.ts` lee su ruta.
 */
const fuente = () => process.env.PACKETSMITH_REGISTRY_URL ||
  "https://registry.npmjs.org/-/package/packetsmith/dist-tags"

export const CACHE_PATH = join(homedir(), ".packetsmith", "version.json")

const rutaCache = () => process.env.PACKETSMITH_VERSION_PATH || CACHE_PATH

/**
 * Cuánto vale la respuesta antes de volver a preguntar.
 *
 * Doce horas es el mismo TTL del catálogo de modelos. Preguntarlo en cada
 * arranque sería pegarle al registro varias veces por día para enterarse de
 * algo que cambia cada varias semanas.
 */
const TTL_MS = 12 * 60 * 60 * 1000

interface Cache {
  latest?: string
  /** Cuándo se preguntó, en epoch ms. */
  checkedAt?: number
}

/**
 * Si `candidata` es posterior a `actual`. Sin dependencias: son tres números.
 *
 * Una prerelease PIERDE contra la estable del mismo número — `0.4.0` es más
 * nueva que `0.4.0-beta.1`—, que es lo que hace que quien está probando una
 * beta se entere cuando sale la definitiva.
 */
export function esMasNueva(candidata: string, actual: string): boolean {
  const nums = (v: string) => v.trim().replace(/^v/, "").split("-")[0]!.split(".")
    .map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [nums(candidata), nums(actual)]

  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  // Mismo número: gana la que no es prerelease.
  return actual.includes("-") && !candidata.includes("-")
}

function leerCache(): Cache {
  try {
    const j = JSON.parse(readFileSync(rutaCache(), "utf8"))
    return j && typeof j === "object" ? j as Cache : {}
  } catch {
    return {}
  }
}

function guardarCache(c: Cache): void {
  try {
    const ruta = rutaCache()
    mkdirSync(dirname(ruta), { recursive: true })
    // Temporal y renombre, como la caché de modelos: si el proceso muere a
    // mitad de la escritura, la copia vieja sigue entera en vez de quedar un
    // JSON cortado que la próxima lectura descarta.
    const tmp = `${ruta}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(c, null, 2) + "\n")
    renameSync(tmp, ruta)
  } catch {
    // Un disco lleno o un HOME de solo lectura no tienen por qué costarle el
    // arranque a nadie. Se pierde la caché, se vuelve a preguntar mañana.
  }
}

/**
 * La última versión publicada, preguntada como mucho una vez cada TTL.
 *
 * Exportada aparte de `versionNueva` porque es la mitad que toca la red, y así
 * se puede testear la comparación sin levantar un servidor.
 */
export async function ultimaPublicada(): Promise<string | undefined> {
  const cache = leerCache()
  const fresca = cache.checkedAt && Date.now() - cache.checkedAt < TTL_MS
  if (fresca) return cache.latest

  try {
    // Dos segundos y no quince: esto es un adorno de la pantalla de arranque,
    // no un dato que la app necesite. Si el registro tarda más, no hay aviso.
    const res = await fetch(fuente(), { signal: AbortSignal.timeout(2_000) })
    if (!res.ok) return cache.latest
    const j = await res.json() as { latest?: unknown }
    const latest = typeof j?.latest === "string" ? j.latest : undefined
    // La marca de tiempo se guarda IGUAL cuando el registro contestó algo
    // inservible: si no, una respuesta rara nos deja preguntando en cada
    // arranque para siempre.
    guardarCache({ ...(latest ? { latest } : {}), checkedAt: Date.now() })
    return latest ?? cache.latest
  } catch {
    return cache.latest
  }
}

/** Qué hay que tipear para actualizar, según cómo se instaló esto. */
export function comoActualizar(exec = process.execPath): string {
  // Los dos instaladores dejan el binario en `~/.packetsmith/bin`; npm lo deja
  // adentro de su `node_modules`. Es la única diferencia que se puede ver desde
  // acá, y alcanza: mandar a alguien a `npm i -g` cuando no tiene npm es peor
  // que no decirle nada.
  const propio = join(homedir(), ".packetsmith", "bin") + sep
  if (!exec.startsWith(propio)) return "npm i -g packetsmith@latest"
  return process.platform === "win32"
    ? "irm https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.sh | sh"
}

/**
 * La versión nueva que haya, o nada.
 *
 * Es lo único que consume la interfaz: devuelve `undefined` cuando estás al
 * día, cuando no hay red y cuando el chequeo está apagado, y la pantalla de
 * arranque no tiene que distinguir entre esos tres casos.
 */
export async function versionNueva(actual: string): Promise<string | undefined> {
  if (process.env.PACKETSMITH_NO_UPDATE_CHECK) return undefined
  const latest = await ultimaPublicada()
  return latest && esMasNueva(latest, actual) ? latest : undefined
}
