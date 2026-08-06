// Lo que elegiste, para no tener que volver a elegirlo.
//
// Un archivo chico en `~/.packetsmith/config.json` —el mismo directorio que ya
// usa el instalador— con el tema, el modelo y el esfuerzo. Nada más: lo que
// guarde esto tiene que ser algo que hayas elegido a propósito, no estado que
// la app pueda deducir sola.
//
// Todo falla ABIERTO. Si el archivo no existe, está roto o no se puede
// escribir, la app arranca con los valores por defecto y no dice nada: perder
// una preferencia es una molestia, no arrancar es un problema.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { EFFORTS, type Effort } from "./engine/types.ts"
import { findTheme } from "./tui/themes.ts"
import { LANGS, type Lang } from "./tui/i18n.ts"

export interface Config {
  engine?: string
  theme?: string
  /**
   * El modelo elegido POR MOTOR.
   *
   * Guardarlo suelto era un bug con dientes: elegías `sonnet` con el CLI de
   * Claude, cambiabas a Kimi, y al arrancar de nuevo la app le pedía a Kimi un
   * modelo llamado `sonnet`. Los alias de un proveedor no existen en el otro.
   */
  models?: Record<string, string>
  effort?: Effort
  language?: Lang
}

export const CONFIG_PATH = join(homedir(), ".packetsmith", "config.json")

/**
 * Lee la config y descarta lo que no sirva.
 *
 * Se valida clave por clave y no de golpe: un tema que ya no existe —porque se
 * renombró entre versiones— no tiene por qué llevarse puesto el modelo que sí
 * era válido.
 */
export function loadConfig(path = CONFIG_PATH): Config {
  let crudo: unknown
  try {
    crudo = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
  if (typeof crudo !== "object" || crudo === null) return {}
  const c = crudo as Record<string, unknown>

  const out: Config = {}
  if (typeof c.engine === "string" && c.engine) out.engine = c.engine
  if (typeof c.theme === "string" && findTheme(c.theme)) out.theme = c.theme
  if (typeof c.models === "object" && c.models) {
    const m: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.models)) if (typeof v === "string" && v) m[k] = v
    if (Object.keys(m).length) out.models = m
  }
  // Config vieja: un solo `model` para todos. Se toma como el del motor que
  // estuviera guardado, que es de donde salió, y se descarta el resto.
  if (typeof c.model === "string" && c.model && typeof c.engine === "string" && c.engine) {
    out.models = { [c.engine]: c.model, ...out.models }
  }
  if (typeof c.effort === "string" && (EFFORTS as readonly string[]).includes(c.effort)) {
    out.effort = c.effort as Effort
  }
  if (typeof c.language === "string" && (LANGS as readonly string[]).includes(c.language)) {
    out.language = c.language as Lang
  }
  return out
}

/** El modelo guardado para un motor, si hay. */
export function modeloDe(engine: string, path = CONFIG_PATH): string | undefined {
  return loadConfig(path).models?.[engine]
}

/** Deja anotado el modelo de UN motor sin tocar los de los otros. */
export function guardarModelo(engine: string, model: string, path = CONFIG_PATH): boolean {
  return saveConfig({ models: { ...loadConfig(path).models, [engine]: model } }, path)
}

/** Guarda, fusionando con lo que ya hubiera. Devuelve si se pudo. */
export function saveConfig(cambios: Config, path = CONFIG_PATH): boolean {
  try {
    const previo = loadConfig(path)
    const merged = { ...previo, ...cambios }
    // `model` suelto es el formato viejo: al reescribir se va, o volvería a
    // ganarle al mapa por motor en la próxima lectura.
    delete (merged as Record<string, unknown>).model
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}
