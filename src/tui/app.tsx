// Composición y estado. Acá vive el ciclo: input → sesión → eventos → UI.
import { createSignal, onCleanup, onMount } from "solid-js"
import type { Engine, Session } from "../engine/types.ts"
import type { Topology } from "../topology/model.ts"
import { EMPTY, ingest } from "../topology/ingest.ts"
import { Chat, shortToolName, type Turn } from "./chat.tsx"
import { Canvas } from "./canvas.tsx"

/** Solo las tools del MCP de Packet Tracer alimentan el panel derecho. */
const PT_TOOL = /(^|__)pt_/

export function App(props: { engine: Engine; model?: string }) {
  const [turns, setTurns] = createSignal<Turn[]>([])
  const [streaming, setStreaming] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [topology, setTopology] = createSignal<Topology>(EMPTY)
  const [lastTool, setLastTool] = createSignal<string>()
  const [draft, setDraft] = createSignal("")
  const [model, setModel] = createSignal(props.model ?? "…")
  const [cost, setCost] = createSignal(0)
  const [toolCount, setToolCount] = createSignal(0)

  let session: Session | undefined
  // Tools del turno en curso. Es un array mutable a propósito: se actualiza en
  // vivo y la lista de turnos se reemplaza para disparar el re-render.
  let live: NonNullable<Turn["tools"]> = []

  onMount(() => {
    session = props.engine.start({ model: props.model })
    void consume(session)
  })
  onCleanup(() => session?.close())

  async function consume(s: Session) {
    for await (const ev of s.events()) {
      switch (ev.type) {
        case "ready":
          setModel(ev.model)
          setToolCount(ev.tools.length)
          break

        case "text":
          setStreaming((t) => t + ev.delta)
          break

        case "tool_start":
          live.push({ name: ev.name, done: false, isError: false })
          setTurns((t) => [...t])
          break

        case "tool_end": {
          const t = live.find((x) => x.name === ev.name && !x.done)
          if (t) { t.done = true; t.isError = ev.isError }
          if (PT_TOOL.test(ev.name) && !ev.isError) {
            setTopology((cur) => ingest(cur, ev.name, ev.output))
            setLastTool(shortToolName(ev.name))
          }
          setTurns((x) => [...x])
          break
        }

        case "turn_end": {
          const tools = live
          live = []
          setCost((c) => c + ev.costUsd)
          setTurns((t) => [...t, { role: "agent", text: ev.text || streaming(), tools }])
          setStreaming("")
          setBusy(false)
          break
        }

        case "error":
          setTurns((t) => [...t, { role: "agent", text: `⚠ ${ev.message}`, tools: live }])
          live = []
          setStreaming("")
          setBusy(false)
          break
      }
    }
  }

  function submit() {
    const text = draft().trim()
    if (!text || busy() || !session) return

    setTurns((t) => [...t, { role: "user", text }])
    setBusy(true)
    setStreaming("")
    // Limpiar el borrador ANTES de mandar: en v0.1 el input quedaba con el
    // texto anterior y no se podía escribir un segundo mensaje.
    setDraft("")
    session.send(text)
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 1 }}>
        <text style={{ fg: "#4fd6be" }}>packetsmith</text>
        <text style={{ fg: "#565f89" }}>
          {`  ${props.engine.name} · ${model()} · ${toolCount()} tools · $${cost().toFixed(4)}`}
        </text>
      </box>

      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Chat turns={turns()} streaming={streaming()} busy={busy()} />
        <Canvas topology={topology()} lastTool={lastTool()} />
      </box>

      <box style={{ border: true, height: 3 }}>
        <input
          focused
          value={draft()}
          placeholder={busy() ? "esperando al agente…" : "describí la red que querés…"}
          onInput={setDraft}
          onSubmit={submit}
        />
      </box>
    </box>
  )
}
