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
  model?: string
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
  if (typeof c.model === "string" && c.model) out.model = c.model
  if (typeof c.effort === "string" && (EFFORTS as readonly string[]).includes(c.effort)) {
    out.effort = c.effort as Effort
  }
  if (typeof c.language === "string" && (LANGS as readonly string[]).includes(c.language)) {
    out.language = c.language as Lang
  }
  return out
}

/** Guarda, fusionando con lo que ya hubiera. Devuelve si se pudo. */
export function saveConfig(cambios: Config, path = CONFIG_PATH): boolean {
  try {
    const merged = { ...loadConfig(path), ...cambios }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}
