// Las credenciales de los proveedores que no son el CLI de Claude.
//
// Un archivo en `~/.packetsmith/auth.json`, modo 0600, más las variables de
// entorno de siempre. Nada de guardar keys en la config general: `config.json`
// se puede compartir para copiar un tema o un modelo, y una key no.
//
// Reglas, y no se negocian:
//   · el entorno GANA sobre el archivo, que es lo que espera cualquiera que
//     exporta una variable para probar algo puntual;
//   · la key se lee y se usa; nunca se imprime, ni se loguea, ni se manda a
//     ningún lado que no sea su propio proveedor;
//   · `/debug` dice SI hay key, jamás cuál.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { findProvider } from "./engine/providers/catalog.ts"

export const AUTH_PATH = join(homedir(), ".packetsmith", "auth.json")

/** La key de un proveedor, o undefined. Entorno primero, después el archivo. */
export function apiKey(provider: string, path = AUTH_PATH): string | undefined {
  for (const v of findProvider(provider)?.env ?? []) {
    const val = process.env[v]
    if (val) return val
  }
  try {
    const j = JSON.parse(readFileSync(path, "utf8"))
    const k = j?.[provider]?.key
    return typeof k === "string" && k ? k : undefined
  } catch {
    return undefined
  }
}

/** Guarda una key con permisos de solo-dueño. Devuelve si se pudo. */
export function setApiKey(provider: string, key: string, path = AUTH_PATH): boolean {
  try {
    let actual: Record<string, unknown> = {}
    try { actual = JSON.parse(readFileSync(path, "utf8")) } catch { /* primera vez */ }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ ...actual, [provider]: { key } }, null, 2) + "\n", {
      mode: 0o600,
    })
    // `writeFileSync` solo aplica el modo al CREAR. Si el archivo ya existía con
    // permisos flojos, se los aprieta igual — que es justo el caso en el que
    // importa.
    chmodSync(path, 0o600)
    return true
  } catch {
    return false
  }
}

/** De dónde saldría la key, para poder explicarlo sin mostrarla. */
export function dondeBuscar(provider: string): string {
  const vars = (findProvider(provider)?.env ?? []).join(", ")
  return vars ? `${vars} o ${AUTH_PATH}` : AUTH_PATH
}

/** Borra la key de un proveedor. Para desconectar sin editar archivos. */
export function clearApiKey(provider: string, path = AUTH_PATH): boolean {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"))
    delete j[provider]
    writeFileSync(path, JSON.stringify(j, null, 2) + "\n", { mode: 0o600 })
    return true
  } catch {
    return false
  }
}
