// Imprime la interfaz en estados fijos, sin tomar la terminal ni levantar un
// agente. `bun run preview`.
//
// Existe porque el TUI no se puede mirar mientras se lo edita: arrancarlo de
// verdad pide Packet Tracer abierto, un turno real y plata. Acá se ven los
// mismos caracteres que se dibujarían, en un segundo y gratis.
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import type { AgentEvent, Engine } from "../src/engine/types.ts"

/** Un motor que no lanza nada: reproduce una lista de eventos y se queda. */
function fakeEngine(events: AgentEvent[]): Engine {
  return {
    name: "claude",
    start() {
      return {
        send() {},
        async *events() {
          for (const e of events) yield e
          await new Promise(() => {})
        },
        close() {},
      }
    },
  }
}

const PLAN = JSON.stringify(
  {
    name: "lab",
    devices: [
      { name: "R1", model: "2911", x: 200, y: 90, interfaces: { "Gi0/0": "10.0.0.1/255.255.255.252", "Gi0/1": "192.168.0.1/255.255.255.0" } },
      { name: "R2", model: "2911", x: 500, y: 90, interfaces: { "Gi0/0": "10.0.0.2/255.255.255.252", "Gi0/1": "192.168.1.1/255.255.255.0" } },
      { name: "SW1", model: "2960", x: 200, y: 240, interfaces: {} },
      { name: "SW2", model: "2960", x: 500, y: 240, interfaces: {} },
      { name: "PC1", model: "PC-PT", x: 120, y: 380, interfaces: { Fa0: "192.168.0.2/255.255.255.0" } },
      { name: "PC2", model: "PC-PT", x: 260, y: 380, interfaces: { Fa0: "192.168.0.3/255.255.255.0" } },
      { name: "PC3", model: "PC-PT", x: 420, y: 380, interfaces: { Fa0: "192.168.1.2/255.255.255.0" } },
      { name: "SRV1", model: "Server-PT", x: 560, y: 380, interfaces: { Fa0: "192.168.1.10/255.255.255.0" } },
    ],
    links: [
      { device_a: "R1", port_a: "Gi0/0", device_b: "R2", port_b: "Gi0/0" },
      { device_a: "R1", port_a: "Gi0/1", device_b: "SW1", port_b: "Gi0/1" },
      { device_a: "R2", port_a: "Gi0/1", device_b: "SW2", port_b: "Gi0/1" },
      { device_a: "SW1", port_a: "Fa0/1", device_b: "PC1", port_b: "Fa0" },
      { device_a: "SW1", port_a: "Fa0/2", device_b: "PC2", port_b: "Fa0" },
      { device_a: "SW2", port_a: "Fa0/1", device_b: "PC3", port_b: "Fa0" },
      { device_a: "SW2", port_a: "Fa0/2", device_b: "SRV1", port_b: "Fa0" },
    ],
  },
  null,
  2,
)

const READY: AgentEvent = {
  type: "ready",
  sessionId: "preview",
  model: "claude-opus-5[1m]",
  tools: new Array(178).fill("t"),
}
const LIMITS: AgentEvent = {
  type: "limits",
  limits: { window: "five_hour", status: "allowed", resetsAt: 0 },
}
const tool = (id: string, name: string) => ({ id, name: `mcp__packet-tracer__${name}` })
const BUILD = tool("1", "pt_full_build")
const PING = tool("2", "pt_verify_connectivity")
const HARDEN = tool("3", "pt_apply_hardening")
const VLANS = tool("4", "pt_read_vlans")
const PORTS = tool("5", "pt_inspect_ports")

const ESCENAS: Record<string, AgentEvent[]> = {
  arranque: [READY, LIMITS],

  razonando: [
    READY,
    LIMITS,
    { type: "phase", phase: "thinking" },
    { type: "thinking", tokens: 1840 },
  ],

  trabajando: [
    READY,
    LIMITS,
    { type: "tool_start", ...BUILD, input: {} },
    { type: "tool_end", ...BUILD, output: `Build OK\n${PLAN}`, isError: false },
    { type: "tool_start", ...VLANS, input: {} },
    { type: "tool_end", ...VLANS, output: "5 VLANs", isError: false },
    { type: "tool_start", ...PORTS, input: {} },
    { type: "tool_end", ...PORTS, output: "ok", isError: false },
    { type: "tool_start", ...PING, input: {} },
    { type: "text", delta: "Cableado listo. Verifico conectividad extremo a extremo…" },
    { type: "phase", phase: "tool", detail: "mcp__packet-tracer__pt_verify_connectivity" },
  ],

  desplegado: [
    READY,
    LIMITS,
    { type: "tool_start", ...BUILD, input: {} },
    { type: "tool_end", ...BUILD, output: `Build OK\n${PLAN}`, isError: false },
    { type: "tool_start", ...VLANS, input: {} },
    { type: "tool_end", ...VLANS, output: "5 VLANs", isError: false },
    { type: "tool_start", ...PORTS, input: {} },
    { type: "tool_end", ...PORTS, output: "ok", isError: false },
    { type: "tool_start", ...PING, input: {} },
    { type: "tool_end", ...PING, output: "4/4 OK", isError: false },
    { type: "tool_start", ...HARDEN, input: {} },
    { type: "tool_end", ...HARDEN, output: "sin usuarios locales", isError: true },
    {
      type: "turn_end",
      costUsd: 0.2144,
      usage: { tokens: 43_500, contextWindow: 1_000_000 },
      text:
        "Listo. Dos LAN con OSPF entre R1 y R2.\n\n" +
        "## Verificación\n\n" +
        "| Prueba | Resultado |\n|---|---|\n| PC1 → SRV1 | 4/4 |\n| PC3 → PC1 | 4/4 |\n\n" +
        "El hardening falló: `login local` sin usuarios dejaría las VTY inservibles.\n\n" +
        "Si querés lo arreglo creando un usuario local antes de tocar las VTY.",
    },
    { type: "phase", phase: "idle" },
  ],
}

const ancho = Number(process.env.COLS ?? 118)
const alto = Number(process.env.ROWS ?? 32)

for (const [nombre, eventos] of Object.entries(ESCENAS)) {
  const setup = await testRender(() => App({ engine: fakeEngine(eventos), model: "opus-5" }), {
    width: ancho,
    height: alto,
  })
  // El App consume los eventos de forma asíncrona: sin esta pausa se captura la
  // primera pintura, cuando todavía no llegó ninguno.
  await new Promise((r) => setTimeout(r, 80))
  await setup.renderOnce()

  const titulo = ` ${nombre.toUpperCase()} `
  console.log(`\n╭${titulo}${"─".repeat(Math.max(0, ancho - titulo.length))}╮`)
  console.log((await setup.captureCharFrame()).split("\n").map((l) => "│" + l).join("\n"))
  console.log("╰" + "─".repeat(ancho) + "╯")
}

process.exit(0)
