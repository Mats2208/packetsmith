// Acotar el agente a un solo servidor MCP es la optimización con el peor
// modo de fallo del proyecto: hacerla mal no lo vuelve lento, lo deja SIN
// ninguna tool pt_*. Por eso los tests son casi todos de la rama de fallo.
import { expect, test, describe, afterAll } from "bun:test"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findServer, isConfigured, scopeToPacketTracer } from "../src/engine/mcp.ts"

const PT = { type: "stdio", command: "/venv/bin/python", args: ["-m", "packet_tracer_mcp"] }

const home = (config?: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), "packetsmith-mcp-"))
  if (config !== undefined) writeFileSync(join(dir, ".claude.json"), JSON.stringify(config))
  return dir
}

describe("findServer", () => {
  test("lo encuentra en el scope de usuario", () => {
    expect(findServer({ mcpServers: { "packet-tracer": PT, blender: {} } }, "/x")).toEqual(PT)
  })

  test("el scope de proyecto gana, como en el CLI", () => {
    const otro = { type: "stdio", command: "/otro" }
    const cfg = { mcpServers: { "packet-tracer": PT }, projects: { "/x": { mcpServers: { "packet-tracer": otro } } } }
    expect(findServer(cfg, "/x")).toEqual(otro)
    // Otro directorio sigue viendo el de usuario.
    expect(findServer(cfg, "/y")).toEqual(PT)
  })

  test("no inventa nada si no está", () => {
    expect(findServer({ mcpServers: { blender: {} } }, "/x")).toBeUndefined()
    expect(findServer({}, "/x")).toBeUndefined()
    expect(findServer(null, "/x")).toBeUndefined()
  })
})

describe("isConfigured", () => {
  // Es la única dependencia que la app no puede resolver sola, y falla de la
  // peor manera: el agente arranca, contesta, y no tiene una sola tool pt_*.
  test("dice que sí cuando el servidor está registrado", () => {
    expect(isConfigured(home({ mcpServers: { "packet-tracer": PT } }), "/x")).toBe(true)
  })

  test("dice que no sin servidor, sin archivo o con el archivo roto", () => {
    expect(isConfigured(home({ mcpServers: { blender: {} } }), "/x")).toBe(false)
    expect(isConfigured(home(), "/x")).toBe(false)
    const roto = home()
    writeFileSync(join(roto, ".claude.json"), "{ no soy json")
    expect(isConfigured(roto, "/x")).toBe(false)
  })
})

describe("scopeToPacketTracer", () => {
  // Los temporales se limpian: la app los borra al cerrar la sesión, y un test
  // que los deja tirados en el directorio temporal del sistema no tiene por qué
  // ser la excepción.
  const dejados: string[] = []
  afterAll(() => {
    for (const p of dejados) rmSync(p, { force: true })
  })

  test("deja un archivo con SOLO el servidor de packet tracer", async () => {
    const dir = home({ mcpServers: { "packet-tracer": PT, blender: { command: "b" }, meshy: { command: "m" } } })
    const { args, path } = scopeToPacketTracer(dir, "/x", 1)
    dejados.push(path!)

    expect(args).toEqual(["--mcp-config", path!, "--strict-mcp-config"])
    expect(await Bun.file(path!).json()).toEqual({ mcpServers: { "packet-tracer": PT } })
  })

  test.skipIf(process.platform === "win32")("el archivo no queda legible por terceros", () => {
    // Lo que se copia sale de `~/.claude.json`, y una definición de servidor MCP
    // puede traer un bloque `env` con credenciales. Dejarlo 0644 en un /tmp
    // compartido sería bajarle los permisos a un secreto por el camino.
    const dir = home({ mcpServers: { "packet-tracer": PT } })
    const { path } = scopeToPacketTracer(dir, "/x", 6)
    dejados.push(path!)
    expect(statSync(path!).mode & 0o077).toBe(0)
  })

  test("sin el servidor, NO acota", () => {
    // `--strict-mcp-config` sin haber encontrado nada dejaría al agente sin una
    // sola tool pt_*: mudo delante de Packet Tracer. Se falla ABIERTO.
    expect(scopeToPacketTracer(home({ mcpServers: { blender: {} } }), "/x", 2).args).toEqual([])
  })

  test("sin archivo de config tampoco acota", () => {
    expect(scopeToPacketTracer(home(), "/x", 3).args).toEqual([])
  })

  test("un config ilegible tampoco acota", () => {
    const dir = home()
    writeFileSync(join(dir, ".claude.json"), "{ no soy json")
    expect(scopeToPacketTracer(dir, "/x", 4).args).toEqual([])
  })

  test("PACKETSMITH_ALL_MCP devuelve el comportamiento anterior", () => {
    const dir = home({ mcpServers: { "packet-tracer": PT } })
    process.env.PACKETSMITH_ALL_MCP = "1"
    try {
      expect(scopeToPacketTracer(dir, "/x", 5).args).toEqual([])
    } finally {
      delete process.env.PACKETSMITH_ALL_MCP
    }
  })
})
