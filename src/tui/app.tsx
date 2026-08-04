// Composición y estado. Acá vive el ciclo: input → motor → eventos → UI.
import { createSignal } from "solid-js"
import type { Engine } from "../engine/types.ts"
import { Chat, type Turn } from "./chat.tsx"
import { Canvas } from "./canvas.tsx"

/** Solo las tools del MCP de Packet Tracer alimentan el panel derecho. */
const PT_TOOL = /(^|__)pt_/

export function App(props: { engine: Engine }) {
  const [turns, setTurns] = createSignal<Turn[]>([])
  const [streaming, setStreaming] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [ptEvents, setPtEvents] = createSignal<string[]>([])
  const [sessionId, setSessionId] = createSignal<string>()

  // OpenTUI declara onSubmit como intersección de dos firmas (evento y valor),
  // así que el handler tiene que aceptar ambas y quedarse con el string.
  function onSubmit(v: unknown) {
    if (typeof v === "string") void send(v)
  }

  async function send(text: string) {
    if (!text.trim() || busy()) return

    setTurns((t) => [...t, { role: "user", text }])
    setBusy(true)
    setStreaming("")

    // El turno del agente se arma en vivo y recién se cierra en `done`: hasta
    // entonces se pinta como `streaming` para que el texto aparezca token a
    // token en vez de de golpe al final.
    const tools: Turn["tools"] = []

    try {
      for await (const ev of props.engine.run({ prompt: text, sessionId: sessionId() })) {
        switch (ev.type) {
          case "text":
            setStreaming((s) => s + ev.delta)
            break

          case "tool_start":
            tools.push({ name: ev.name, done: false, isError: false })
            setTurns((t) => [...t])
            break

          case "tool_end": {
            const t = tools.find((x) => x.name === ev.name && !x.done)
            if (t) { t.done = true; t.isError = ev.isError }
            if (PT_TOOL.test(ev.name)) setPtEvents((p) => [...p, ev.name])
            setTurns((x) => [...x])
            break
          }

          case "done":
            setSessionId(ev.sessionId)
            setTurns((t) => [...t, { role: "agent", text: ev.text || streaming(), tools }])
            setStreaming("")
            break

          case "error":
            setTurns((t) => [...t, { role: "agent", text: `⚠ ${ev.message}`, tools }])
            setStreaming("")
            break
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Chat turns={turns()} streaming={streaming()} busy={busy()} />
        <Canvas events={ptEvents()} />
      </box>
      <box style={{ border: true, height: 3, padding: 0 }}>
        <input
          focused
          placeholder="describí la red que querés…"
          onSubmit={onSubmit}
        />
      </box>
    </box>
  )
}
