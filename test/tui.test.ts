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

describe("markdown selectivo", () => {
  test("los encabezados se destacan sin dejar los ##", async () => {
    const turns: Turn[] = [{ role: "agent", text: "## Verificación\ntodo ok" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    expect(frame).toContain("VERIFICACIÓN")
    expect(frame).not.toContain("##")
  })

  test("las tablas se alinean en columnas", async () => {
    // Una tabla desalineada es peor que no tenerla: el pipe crudo no dice nada.
    const turns: Turn[] = [{
      role: "agent",
      text: "| Prueba | Resultado |\n|---|---|\n| PC1 → SRV | 4/4 |",
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }), 70, 12)
    expect(frame).toContain("Prueba")
    expect(frame).toContain("4/4")
    expect(frame).not.toContain("|---|")
  })

  test("el bold y el código inline pierden el marcado, no el texto", async () => {
    const turns: Turn[] = [{ role: "agent", text: "**Antes:** 9 equipos con `Gi0/1`" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    expect(frame).toContain("Antes:")
    expect(frame).toContain("Gi0/1")
    expect(frame).not.toContain("**")
    expect(frame).not.toContain("`")
  })
})

describe("pantalla de bienvenida", () => {
  test("el wordmark se dibuja completo, no colapsado", async () => {
    // Gotcha de OpenTUI: varios <text> hermanos se pintan sobre la MISMA fila,
    // y un <text> multilínea sin altura declarada deja que el siguiente le pise
    // las últimas. El wordmark de 3 filas llegó a verse como 1.
    const frame = await frameOf(() => Chat({ turns: [], streaming: "", busy: false }), 60, 18)
    const rows = frame.split("\n").filter((r) => r.includes("█"))
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test("muestra la cadena y desaparece al primer mensaje", async () => {
    const empty = await frameOf(() => Chat({ turns: [], streaming: "", busy: false }), 60, 18)
    expect(empty).toContain("packet tracer")

    // Un banner permanente robaría las filas que el chat necesita.
    const used = await frameOf(
      () => Chat({ turns: [{ role: "user", text: "hola" }], streaming: "", busy: false }), 60, 18)
    expect(used).not.toContain("packet tracer")
  })
})
