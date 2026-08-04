// Acotar el agente a un solo servidor MCP es la optimización con el peor
// modo de fallo del proyecto: hacerla mal no lo vuelve lento, lo deja SIN
// ninguna tool pt_*. Por eso los tests son casi todos de la rama de fallo.
import { expect, test, describe } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findServer, scopeToPacketTracer } from "../src/engine/mcp.ts"

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

describe("scopeToPacketTracer", () => {
  test("deja un archivo con SOLO el servidor de packet tracer", async () => {
    const dir = home({ mcpServers: { "packet-tracer": PT, blender: { command: "b" }, meshy: { command: "m" } } })
    const { args, path } = scopeToPacketTracer(dir, "/x", 1)

    expect(args).toEqual(["--mcp-config", path!, "--strict-mcp-config"])
    expect(await Bun.file(path!).json()).toEqual({ mcpServers: { "packet-tracer": PT } })
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
