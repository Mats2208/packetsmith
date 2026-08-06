// ¿Somos nosotros o es el agente? `bun run bench`.
//
// PacketSmith es un proceso APARTE de `claude`, así que dibujar despacio no
// puede hacer pensar más lento al modelo. Lo único que sí puede frenarlo es la
// contrapresión: si no vaciamos su stdout al ritmo que escribe, el pipe se
// llena y el CLI se bloquea escribiendo.
//
// Esto mide las dos mitades por separado —parsear y dibujar— contra un stream
// del tamaño de una respuesta real, para poder decir cuál de las dos, si
// alguna, está cerca de ser un cuello de botella.
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/app.tsx"
import { translate } from "../src/engine/claude.ts"
import type { AgentEvent, Engine } from "../src/engine/types.ts"

/** Una respuesta larga de verdad: ~4000 fragmentos, como un informe de deploy. */
const DELTAS = 4000
const TOOLS = 60

function delta(i: number): unknown {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: `tok${i} ` } },
  }
}

function timed(label: string, fn: () => void): number {
  const t0 = performance.now()
  fn()
  const ms = performance.now() - t0
  console.log(`${label.padEnd(46)} ${ms.toFixed(0).padStart(6)} ms`)
  return ms
}

console.log(`\n─── ${DELTAS} fragmentos de texto + ${TOOLS} tools ───\n`)

// 1. Traducir el stream. Es lo único que corre por evento pase lo que pase.
const names = new Map<string, string>()
timed("translate() de los eventos", () => {
  for (let i = 0; i < DELTAS; i++) for (const _ of translate(delta(i), names)) { /* drenar */ }
})

// 2. El ciclo completo con la interfaz montada, que es lo que corre de verdad.
function benchEngine(events: AgentEvent[]): Engine {
  return {
    name: "claude",
    start() {
      return {
        send: () => true,
        async *events() {
          for (const e of events) yield e
          done = performance.now()
          await new Promise(() => {})
        },
        close() {},
      }
    },
  }
}

const guion: AgentEvent[] = [
  { type: "ready", sessionId: "b", model: "claude-opus-5[1m]", tools: [] },
  ...Array.from({ length: TOOLS }, (_, i): AgentEvent[] => [
    { type: "tool_start", id: `t${i}`, name: "mcp__packet-tracer__pt_send_raw", input: {} },
    { type: "tool_end", id: `t${i}`, name: "mcp__packet-tracer__pt_send_raw", output: "OK", isError: false },
  ]).flat(),
  ...Array.from({ length: DELTAS }, (_, i): AgentEvent => ({ type: "text", delta: `tok${i} ` })),
]

let done = 0
const t0 = performance.now()
const setup = await testRender(
  () => App({ engine: benchEngine(guion), model: "opus-5", columns: 130, quota: { session: 20 } }),
  { width: 130, height: 40 },
)
// Se espera a que el generador drene la lista entera.
while (!done) await new Promise((r) => setTimeout(r, 5))
await setup.renderOnce()

const ms = done - t0
console.log(`${"ciclo completo con la UI montada".padEnd(46)} ${ms.toFixed(0).padStart(6)} ms`)
console.log(`${"por evento".padEnd(46)} ${(ms / guion.length).toFixed(3).padStart(6)} ms`)

// Un turno real de Claude escribe del orden de 50 fragmentos por segundo. Si
// vaciamos a más de eso, la contrapresión no existe y el tiempo se va en otro
// lado: en el modelo pensando o en el bridge esperando a Packet Tracer.
const porSegundo = Math.round(guion.length / (ms / 1000))
console.log(`\ncapacidad: ${porSegundo.toLocaleString()} eventos/s`)
console.log(porSegundo > 500
  ? "→ el consumo no es cuello de botella: el tiempo se va en el modelo o en el bridge."
  : "→ ATENCIÓN: podríamos estar frenando al CLI por contrapresión.")

process.exit(0)
