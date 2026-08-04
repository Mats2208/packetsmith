// Escenas fijas de la interfaz, compartidas por el preview y las capturas.
//
// Viven acá y no en cada script porque son la misma cosa mirada de dos formas:
// el preview las imprime a la terminal para revisar un cambio en un segundo,
// y `shots` las vuelca a HTML para el README. Duplicarlas garantizaría que una
// de las dos quede vieja.
import type { AgentEvent, Quota } from "../src/engine/types.ts"

export interface Escena {
  cols: number
  rows: number
  eventos: AgentEvent[]
  quota?: Quota
}

/** Ancho del panel de topología, para calcular el resto. */
export const PANEL = 42

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
  sessionId: "demo",
  model: "claude-opus-5[1m]",
  tools: new Array(94).fill("t"),
}
const LIMITS: AgentEvent = {
  type: "limits",
  limits: { window: "five_hour", status: "allowed", resetsAt: 0 },
}

const tool = (id: string, name: string) => ({ id, name: `mcp__packet-tracer__${name}` })
const BUILD = tool("1", "pt_full_build")
const PING = tool("2", "pt_verify_connectivity")
const VLANS = tool("3", "pt_read_vlans")
const PORTS = tool("4", "pt_inspect_ports")

const QUOTA: Quota = { session: 23, weekly: 51 }

/** El turno completo, con topología, tabla, plano y cronometraje. */
const DEPLOY: AgentEvent[] = [
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
  {
    type: "turn_end",
    costUsd: 0.5105,
    usage: { tokens: 41_000, contextWindow: 1_000_000 },
    text:
      "Una estrella de dos niveles: el 3560 hace de núcleo con `ip routing` y " +
      "SVIs por VLAN, y cada departamento cuelga de su propio 2960 de acceso.\n\n" +
      "Verificado contra los equipos, no contra el plan:\n\n" +
      "| Qué | Resultado |\n|---|---|\n" +
      "| VLANs 10/20/30 en SW-CORE | las tres presentes |\n" +
      "| Ping PC-VEN1 → SRV-WEB | OK (4/4) |\n" +
      "| Ping PC-IT1 → PC-RH1 | OK (4/4) |\n\n" +
      "Una cosa que conviene saber: no hay redundancia. Si se cae el 3560 o un " +
      "uplink, esa zona queda aislada.",
  },
  { type: "phase", phase: "idle" },
]

export const ESCENAS: Record<string, Escena> = {
  /** La primera pantalla, con el puente ya levantado. */
  bienvenida: { cols: 118, rows: 30, eventos: [READY, LIMITS], quota: QUOTA },

  /** Un turno terminado: badges, tabla, plano y panel poblado. */
  deploy: { cols: 132, rows: 42, eventos: DEPLOY, quota: QUOTA },

  /** Mientras trabaja: fase, tokens de razonamiento y reloj. */
  trabajando: {
    cols: 118,
    rows: 26,
    quota: QUOTA,
    eventos: [
      READY,
      LIMITS,
      { type: "tool_start", ...BUILD, input: {} },
      { type: "tool_end", ...BUILD, output: `Build OK\n${PLAN}`, isError: false },
      { type: "tool_start", ...PING, input: {} },
      { type: "text", delta: "Cableado listo. Verifico conectividad extremo a extremo…" },
      { type: "phase", phase: "thinking" },
      { type: "thinking", tokens: 2480 },
    ],
  },
}
