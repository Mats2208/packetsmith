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

// Las coordenadas son las de un canvas real de Packet Tracer: el plano bajo la
// respuesta las usa tal cual, así que un fixture con todo en (0,0) no probaría
// nada.
const PLAN = JSON.stringify(
  {
    name: "lab",
    devices: [
      { name: "R-EDGE", model: "2911", x: 400, y: 60, interfaces: { "Gi0/0": "192.168.10.1/255.255.255.0" } },
      { name: "SW-CORE", model: "3560-24PS", x: 400, y: 180, interfaces: { Vlan1: "192.168.10.2/255.255.255.0" } },
      { name: "SW-VENTAS", model: "2960", x: 120, y: 300, interfaces: {} },
      { name: "SW-IT", model: "2960", x: 300, y: 300, interfaces: {} },
      { name: "SW-RRHH", model: "2960", x: 500, y: 300, interfaces: {} },
      { name: "SW-DATACENTER", model: "2960", x: 680, y: 300, interfaces: {} },
      { name: "PC-VEN1", model: "PC-PT", x: 80, y: 420, interfaces: { Fa0: "192.168.10.11/255.255.255.0" } },
      { name: "PC-VEN2", model: "PC-PT", x: 165, y: 420, interfaces: { Fa0: "192.168.10.12/255.255.255.0" } },
      { name: "PC-IT1", model: "PC-PT", x: 260, y: 420, interfaces: { Fa0: "192.168.10.21/255.255.255.0" } },
      { name: "PC-IT2", model: "PC-PT", x: 345, y: 420, interfaces: { Fa0: "192.168.10.22/255.255.255.0" } },
      { name: "PC-RH1", model: "PC-PT", x: 460, y: 420, interfaces: { Fa0: "192.168.10.31/255.255.255.0" } },
      { name: "PC-RH2", model: "PC-PT", x: 545, y: 420, interfaces: { Fa0: "192.168.10.32/255.255.255.0" } },
      { name: "SRV-WEB", model: "Server-PT", x: 640, y: 420, interfaces: { Fa0: "192.168.10.41/255.255.255.0" } },
      { name: "SRV-DNS", model: "Server-PT", x: 725, y: 420, interfaces: { Fa0: "192.168.10.42/255.255.255.0" } },
    ],
    links: [
      { device_a: "R-EDGE", port_a: "Gi0/0", device_b: "SW-CORE", port_b: "Gi0/1" },
      { device_a: "SW-CORE", port_a: "Fa0/1", device_b: "SW-VENTAS", port_b: "Gi0/1" },
      { device_a: "SW-CORE", port_a: "Fa0/2", device_b: "SW-IT", port_b: "Gi0/1" },
      { device_a: "SW-CORE", port_a: "Fa0/3", device_b: "SW-RRHH", port_b: "Gi0/1" },
      { device_a: "SW-CORE", port_a: "Fa0/4", device_b: "SW-DATACENTER", port_b: "Gi0/1" },
      { device_a: "SW-VENTAS", port_a: "Fa0/1", device_b: "PC-VEN1", port_b: "Fa0" },
      { device_a: "SW-VENTAS", port_a: "Fa0/2", device_b: "PC-VEN2", port_b: "Fa0" },
      { device_a: "SW-IT", port_a: "Fa0/1", device_b: "PC-IT1", port_b: "Fa0" },
      { device_a: "SW-IT", port_a: "Fa0/2", device_b: "PC-IT2", port_b: "Fa0" },
      { device_a: "SW-RRHH", port_a: "Fa0/1", device_b: "PC-RH1", port_b: "Fa0" },
      { device_a: "SW-RRHH", port_a: "Fa0/2", device_b: "PC-RH2", port_b: "Fa0" },
      { device_a: "SW-DATACENTER", port_a: "Fa0/1", device_b: "SRV-WEB", port_b: "Fa0" },
      { device_a: "SW-DATACENTER", port_a: "Fa0/2", device_b: "SRV-DNS", port_b: "Fa0" },
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
        "Es una estrella clásica de dos niveles: el 3560 hace de núcleo y cada " +
        "departamento cuelga de su propio 2960 de acceso.\n\n" +
        "## Verificación\n\n" +
        "| Prueba | Resultado |\n|---|---|\n| PC-VEN1 → SRV-WEB | 4/4 |\n| PC-IT1 → PC-RH1 | 4/4 |\n\n" +
        "El hardening falló: `login local` sin usuarios dejaría las VTY inservibles.",
    },
    { type: "phase", phase: "idle" },
  ],
}

const ancho = Number(process.env.COLS ?? 118)
const alto = Number(process.env.ROWS ?? 32)

for (const [nombre, eventos] of Object.entries(ESCENAS)) {
  // `columns` va explícito: se renderiza a un buffer, no a la terminal, así que
  // `process.stdout.columns` mediría la ventana equivocada y el plano saldría
  // escalado a un ancho que no es el que se está dibujando.
  const setup = await testRender(
    () => App({ engine: fakeEngine(eventos), model: "opus-5", columns: ancho }),
    { width: ancho, height: alto },
  )
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
