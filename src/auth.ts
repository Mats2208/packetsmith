// Las credenciales de los proveedores que no son el CLI de Claude.
//
// Un archivo en `~/.packetsmith/auth.json`, modo 0600, más las variables de
// entorno de siempre. Nada de guardar keys en la config general: `config.json`
// se puede compartir para copiar un tema o un modelo, y una key no.
//
// Guarda DOS clases de credencial, porque los proveedores tienen dos formas de
// dejarte entrar: una key que pegás, y un login que devuelve tokens que vencen.
// La segunda trae un `refresh` que hay que poder reescribir sin perder el resto
// del archivo, y por eso esto no es un `Record<string, string>`.
//
// Reglas, y no se negocian:
//   · el entorno GANA sobre el archivo, que es lo que espera cualquiera que
//     exporta una variable para probar algo puntual;
//   · la credencial se lee y se usa; nunca se imprime, ni se loguea, ni se
//     manda a ningún lado que no sea su propio proveedor;
//   · `/debug` dice SI hay credencial, jamás cuál.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { findPlan, variablesDe } from "./engine/providers/catalog.ts"

export const AUTH_PATH = join(homedir(), ".packetsmith", "auth.json")

/** Lo que queda escrito para un proveedor. */
export interface Guardado {
  /** Cuál de sus planes se eligió. Ausente = el primero. */
  plan?: string
  tipo?: "api" | "oauth"
  /** Con `tipo: "api"`. */
  key?: string
  /** Con `tipo: "oauth"`. */
  access?: string
  refresh?: string
  /** Epoch en milisegundos. */
  expires?: number
  accountId?: string
}

function leer(path: string): Record<string, Guardado> {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"))
    return j && typeof j === "object" ? j : {}
  } catch {
    return {}
  }
}

function escribir(path: string, datos: Record<string, Guardado>): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(datos, null, 2) + "\n", { mode: 0o600 })
    // `writeFileSync` solo aplica el modo al CREAR. Si el archivo ya existía con
    // permisos flojos, se los aprieta igual — que es justo el caso en el que
    // importa.
    chmodSync(path, 0o600)
    return true
  } catch {
    return false
  }
}

/** Lo guardado para un proveedor, tal cual. */
export function credencialGuardada(provider: string, path = AUTH_PATH): Guardado | undefined {
  const g = leer(path)[provider]
  return g && typeof g === "object" ? g : undefined
}

/** Qué plan tiene elegido. El primero del catálogo si nunca eligió. */
export function planElegido(provider: string, path = AUTH_PATH): string | undefined {
  return credencialGuardada(provider, path)?.plan ?? findPlan(provider)?.id
}

/**
 * La key de un proveedor, o undefined. Entorno primero, después el archivo.
 *
 * Las variables se miran las del plan pedido; si no se pide ninguno, las de
 * TODOS sus planes — porque quien exporta `MOONSHOT_API_KEY` para probar espera
 * que se use, haya elegido plan o no.
 */
export function apiKey(provider: string, planId?: string, path = AUTH_PATH): string | undefined {
  const vars = planId ? (findPlan(provider, planId)?.env ?? []) : variablesDe(provider)
  for (const v of vars) {
    const val = process.env[v]
    if (val) return val
  }
  const g = credencialGuardada(provider, path)
  if (!g || (g.tipo && g.tipo !== "api")) return undefined
  return typeof g.key === "string" && g.key ? g.key : undefined
}

/** Guarda una key con permisos de solo-dueño. Devuelve si se pudo. */
export function setApiKey(provider: string, key: string, plan?: string, path = AUTH_PATH): boolean {
  const datos = leer(path)
  datos[provider] = { tipo: "api", key, ...(plan ? { plan } : {}) }
  return escribir(path, datos)
}

/** Guarda los tokens de un login. Mismo archivo, mismos permisos. */
export function setOauth(
  provider: string,
  tokens: { access: string; refresh: string; expires: number; accountId?: string },
  plan?: string,
  path = AUTH_PATH,
): boolean {
  const datos = leer(path)
  datos[provider] = {
    tipo: "oauth",
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
    ...(plan ? { plan } : {}),
  }
  return escribir(path, datos)
}

/** Deja anotado qué plan usa, sin tocar la credencial. */
export function setPlan(provider: string, plan: string, path = AUTH_PATH): boolean {
  const datos = leer(path)
  datos[provider] = { ...(datos[provider] ?? {}), plan }
  return escribir(path, datos)
}

/** Si hay con qué conectarse, sea key o login. */
export function hayCredencial(provider: string, path = AUTH_PATH): boolean {
  if (apiKey(provider, undefined, path)) return true
  const g = credencialGuardada(provider, path)
  return g?.tipo === "oauth" && !!g.refresh
}

/** De dónde saldría la key, para poder explicarlo sin mostrarla. */
export function dondeBuscar(provider: string): string {
  const vars = variablesDe(provider).join(", ")
  return vars ? `${vars} o ${AUTH_PATH}` : AUTH_PATH
}

/** Borra la credencial de un proveedor. Para desconectar sin editar archivos. */
export function clearApiKey(provider: string, path = AUTH_PATH): boolean {
  const datos = leer(path)
  if (!(provider in datos)) return false
  delete datos[provider]
  return escribir(path, datos)
}
