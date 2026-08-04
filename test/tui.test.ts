// Los tests del TUI usan testRender + captureCharFrame: renderizan a un buffer
// de caracteres en memoria, sin tomar la terminal. Así se puede afirmar qué se
// ve realmente en pantalla en vez de suponerlo.
import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { Chat, shortToolName, type Turn } from "../src/tui/chat.tsx"
import { Canvas } from "../src/tui/canvas.tsx"
import type { Topology } from "../src/topology/model.ts"
import { EMPTY } from "../src/topology/ingest.ts"

async function frameOf(node: () => any, width = 70, height = 14): Promise<string> {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  return await setup.captureCharFrame()
}

describe("shortToolName", () => {
  test("saca el prefijo del MCP para que quepa en el panel", () => {
    expect(shortToolName("mcp__packet-tracer__pt_full_build")).toBe("pt_full_build")
  })

  test("deja intactas las tools que no son del MCP", () => {
    expect(shortToolName("Read")).toBe("Read")
  })
})

describe("Chat", () => {
  test("etiqueta explícitamente quién dijo cada cosa", async () => {
    // Con solo un color y un símbolo no se distinguía de un vistazo de quién
    // era cada mensaje; fue lo primero que se notó usando la app.
    const turns: Turn[] = [
      { role: "user", text: "crea 3 routers" },
      { role: "agent", text: "listo" },
    ]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    // Framing direccional: el chevron dice de qué lado viene el mensaje.
    expect(frame).toContain(">>> VOS")
    expect(frame).toContain("<<< AGENTE")
    expect(frame).toContain("crea 3 routers")
    expect(frame).toContain("listo")
  })

  test("los bloques de código se despegan de la prosa", async () => {
    const turns: Turn[] = [{
      role: "agent",
      text: "Pegá esto:\n```\nenable\nconfigure terminal\n```\nY listo.",
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }), 70, 16)

    expect(frame).toContain("configure terminal")
    // Los ``` no se muestran crudos: se convierten en un bloque con fondo.
    expect(frame).not.toContain("```")
  })

  test("muestra el texto que está llegando antes de cerrar el turno", async () => {
    // Es la razón de ser del streaming: si esto no se ve, el usuario espera
    // mirando una pantalla quieta hasta que el agente termina.
    const frame = await frameOf(() => Chat({ turns: [], streaming: "escribiendo…", busy: true }))
    expect(frame).toContain("escribiendo…")
    expect(frame).toContain("/// working")
  })

  test("marca las tools según su estado", async () => {
    const turns: Turn[] = [{
      role: "agent",
      text: "hecho",
      tools: [
        { name: "mcp__packet-tracer__pt_full_build", done: true, isError: false },
        { name: "mcp__packet-tracer__pt_add_device", done: true, isError: true },
        { name: "mcp__packet-tracer__pt_screenshot", done: false, isError: false },
      ],
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    // El rojo es el único acento y se reserva para lo que falló; lo que salió
    // bien va apagado, porque no hay nada que decidir con eso.
    expect(frame).toContain("✗ pt_add_device")
    expect(frame).toContain("pt_full_build")
    expect(frame).toContain("pt_screenshot")
  })
})

describe("Canvas", () => {
  const TOPO: Topology = {
    devices: [
      { name: "R1", model: "2911", x: 200, y: 90, ports: [
        { name: "Gi0/1", ip: "192.168.0.1/255.255.255.0", linked: true },
      ] },
      { name: "SW1", model: "3560-24PS", x: 200, y: 230, ports: [
        { name: "Gi0/1", linked: true },
      ] },
      { name: "PC1", model: "PC-PT", x: 70, y: 360, ports: [
        { name: "Fa0", ip: "192.168.0.3/255.255.255.0", linked: true },
      ] },
    ],
    links: [
      { a: { device: "R1", port: "Gi0/1" }, b: { device: "SW1", port: "Gi0/1" }, wireless: false },
      { a: { device: "SW1", port: "Fa0/1" }, b: { device: "PC1", port: "Fa0" }, wireless: false },
    ],
  }

  test("dice que no hay datos en vez de quedar mudo", async () => {
    const frame = await frameOf(() => Canvas({ topology: EMPTY }))
    expect(frame).toContain("[ TOPOLOGY ]")
    expect(frame).toContain("awaiting deployment")
  })

  test("dibuja la jerarquía router → switch → host", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)

    expect(frame).toContain("R1")
    expect(frame).toContain("SW1")
    expect(frame).toContain("PC1")
    // La sangría es lo que comunica la jerarquía: sin ella es una lista plana.
    const rows = frame.split("\n")
    const r1 = rows.findIndex((l) => l.includes("R1"))
    const pc1 = rows.findIndex((l) => l.includes("PC1"))
    expect(rows[pc1]!.indexOf("PC1")).toBeGreaterThan(rows[r1]!.indexOf("R1"))
  })

  test("el indicador de enlace distingue conectado de no conectado", async () => {
    // Único uso del verde en toda la interfaz: si todo resalta, nada resalta.
    const off = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)
    const on = await frameOf(() => Canvas({ topology: TOPO, live: true }), 46, 14)
    expect(off).toContain("○")
    expect(on).toContain("●")
  })

  test("muestra las IPs junto a cada equipo", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)
    expect(frame).toContain("192.168.0.1")
  })

  test("resume el tamaño de la red en el encabezado", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO, lastTool: "pt_full_build" }), 46, 14)
    expect(frame).toContain("3 NODES / 2 LINKS")
  })
})
