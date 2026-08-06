// Lo que elegiste tiene que sobrevivir a cerrar la app, y un archivo roto no
// tiene derecho a impedir que arranque.
import { expect, test, describe, afterAll } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, saveConfig } from "../src/config.ts"

const dirs: string[] = []
const ruta = (contenido?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "packetsmith-cfg-"))
  dirs.push(dir)
  const p = join(dir, "config.json")
  if (contenido !== undefined) writeFileSync(p, contenido)
  return p
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

describe("loadConfig", () => {
  test("lee lo que se guardó", () => {
    const p = ruta('{"theme":"nord","model":"sonnet","effort":"high"}')
    expect(loadConfig(p)).toEqual({ theme: "nord", model: "sonnet", effort: "high" })
  })

  test("sin archivo no es un error, es el primer arranque", () => {
    expect(loadConfig(join(tmpdir(), "no-existe-jamas.json"))).toEqual({})
  })

  test("un archivo roto no impide arrancar", () => {
    // Perder una preferencia es una molestia; no arrancar es un problema.
    expect(loadConfig(ruta("{ no soy json"))).toEqual({})
    expect(loadConfig(ruta("null"))).toEqual({})
    expect(loadConfig(ruta('"una cadena"'))).toEqual({})
  })

  test("una clave inválida no se lleva puestas a las demás", () => {
    // Un tema que se renombró entre versiones no tiene por qué costarte el
    // modelo, que seguía siendo perfectamente válido.
    const p = ruta('{"theme":"tema-que-ya-no-existe","model":"opus","effort":"altisimo"}')
    expect(loadConfig(p)).toEqual({ model: "opus" })
  })

  test("un tema que no existe se descarta en vez de romper el arranque", () => {
    expect(loadConfig(ruta('{"theme":"inventado"}'))).toEqual({})
  })

  test("solo se aceptan los niveles de esfuerzo que el CLI conoce", () => {
    expect(loadConfig(ruta('{"effort":"max"}'))).toEqual({ effort: "max" })
    expect(loadConfig(ruta('{"effort":"ultra"}'))).toEqual({})
  })
})

describe("saveConfig", () => {
  test("guarda y se puede volver a leer", () => {
    const p = ruta()
    expect(saveConfig({ theme: "gruvbox" }, p)).toBe(true)
    expect(loadConfig(p)).toEqual({ theme: "gruvbox" })
  })

  test("fusiona en vez de pisar", () => {
    // Cambiar el tema no tiene por qué borrar el modelo que elegiste antes.
    const p = ruta()
    saveConfig({ model: "haiku" }, p)
    saveConfig({ theme: "dracula" }, p)
    expect(loadConfig(p)).toEqual({ model: "haiku", theme: "dracula" })
  })

  test("no poder escribir no rompe nada", () => {
    // Un disco lleno o un directorio sin permiso: la app sigue andando, solo
    // que no se acuerda para la próxima. Se simula pidiendo escribir DENTRO de
    // un archivo, que es un directorio que no puede existir.
    const archivo = ruta("{}")
    expect(saveConfig({ theme: "nord" }, join(archivo, "sub", "x.json"))).toBe(false)
  })
})
