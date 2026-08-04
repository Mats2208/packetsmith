// Los tests del TUI usan testRender + captureCharFrame: renderizan a un buffer
// de caracteres en memoria, sin tomar la terminal. Así se puede afirmar qué se
// ve realmente en pantalla en vez de suponerlo.
import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { Chat, shortToolName, type Turn } from "../src/tui/chat.tsx"
import { Canvas } from "../src/tui/canvas.tsx"

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
  test("distingue el turno del usuario del agente", async () => {
    const turns: Turn[] = [
      { role: "user", text: "crea 3 routers" },
      { role: "agent", text: "listo" },
    ]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    expect(frame).toContain("› crea 3 routers")
    expect(frame).toContain("listo")
  })

  test("muestra el texto que está llegando antes de cerrar el turno", async () => {
    // Es la razón de ser del streaming: si esto no se ve, el usuario espera
    // mirando una pantalla quieta hasta que el agente termina.
    const frame = await frameOf(() => Chat({ turns: [], streaming: "escribiendo…", busy: true }))
    expect(frame).toContain("escribiendo…")
    expect(frame).toContain("pensando")
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

    expect(frame).toContain("✓ pt_full_build")
    expect(frame).toContain("✗ pt_add_device")   // error, no se disfraza de éxito
    expect(frame).toContain("● pt_screenshot")   // todavía corriendo
  })
})

describe("Canvas", () => {
  test("dice que está vacío en vez de mostrar un panel mudo", async () => {
    const frame = await frameOf(() => Canvas({ events: [] }))
    expect(frame).toContain("TOPOLOGÍA")
    expect(frame).toContain("sin actividad")
  })

  test("lista las tools de Packet Tracer que se ejecutaron", async () => {
    const frame = await frameOf(() => Canvas({ events: ["mcp__packet-tracer__pt_full_build"] }))
    expect(frame).toContain("pt_full_build")
    expect(frame).not.toContain("sin actividad")
  })
})
