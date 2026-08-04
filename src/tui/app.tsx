// Composición y estado. Acá vive el ciclo: input → sesión → eventos → UI.
import { createSignal, onCleanup, onMount } from "solid-js"
import type { Engine, Session } from "../engine/types.ts"
import type { Topology } from "../topology/model.ts"
import { EMPTY, ingest } from "../topology/ingest.ts"
import { Chat, shortToolName, type Turn } from "./chat.tsx"
import { Canvas } from "./canvas.tsx"
import { C } from "./theme.ts"
import { sweep } from "./ascii.ts"
import { Hairline, Hud } from "./frame.tsx"

/** Solo las tools del MCP de Packet Tracer alimentan el panel derecho. */
const PT_TOOL = /(^|__)pt_/

/** Va en la placa de la cabecera. Se sube a mano con cada release. */
const REV = "0.2"

/**
 * Si el puente con Packet Tracer está vivo, leído del texto que devolvió la tool.
 *
 * Se mira el TEXTO y no el flag `isError`, por dos razones opuestas:
 *   · "no está conectado" llega como resultado OK, no como error;
 *   · un `isError` casi siempre es la operación que falló, no el transporte —
 *     un `pt_apply_hardening` rechazado marcaba el puente como caído cuando
 *     estaba perfecto, y el indicador verde se apagaba sin motivo.
 */
export function bridgeIsUp(output: unknown): boolean {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "")
  return !/no est[áa] conectado|not connected/i.test(text)
}

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
  // Enlace con Packet Tracer: se deduce de si la ultima pt_* respondio bien.
  // Es el unico dato binario que importa de un vistazo, y el unico verde.
  const [bridgeLive, setBridgeLive] = createSignal(false)
  // Avanza con cada evento del stream: da un spinner sin timers ni intervalos,
  // y de paso late al ritmo REAL del agente en vez de a un ritmo inventado.
  const [tick, setTick] = createSignal(0)

  let session: Session | undefined
  // Tools del turno en curso, como signal para que el panel las muestre
  // mientras corren en vez de recién al cerrar el turno.
  const [live, setLive] = createSignal<NonNullable<Turn["tools"]>>([])

  onMount(() => {
    session = props.engine.start({ model: props.model })
    void consume(session)
  })
  onCleanup(() => session?.close())

  async function consume(s: Session) {
    for await (const ev of s.events()) {
      setTick((n) => n + 1)
      switch (ev.type) {
        case "ready":
          setModel(ev.model)
          setToolCount(ev.tools.length)
          break

        case "text":
          setStreaming((t) => t + ev.delta)
          break

        case "tool_start":
          setLive((l) => [...l, { name: ev.name, done: false, isError: false }])
          break

        case "tool_end": {
          setLive((l) => {
            const i = l.findIndex((x) => x.name === ev.name && !x.done)
            if (i === -1) return l
            const copy = [...l]
            copy[i] = { ...copy[i]!, done: true, isError: ev.isError }
            return copy
          })
          if (PT_TOOL.test(ev.name)) {
            setLastTool(shortToolName(ev.name))
            setBridgeLive(bridgeIsUp(ev.output))
            if (!ev.isError) setTopology((cur) => ingest(cur, ev.name, ev.output))
          }
          break
        }

        case "turn_end": {
          const tools = live()
          setLive([])
          setCost((c) => c + ev.costUsd)
          setTurns((t) => [...t, { role: "agent", text: ev.text || streaming(), tools }])
          setStreaming("")
          setBusy(false)
          break
        }

        case "error":
          setTurns((t) => [...t, { role: "agent", text: `⚠ ${ev.message}`, tools: live() }])
          setLive([])
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
    // El fondo se declara acá y no en la terminal: sin esto el tema del usuario
    // se filtra por debajo y la paleta "casi-negro" que define el arquetipo no
    // llega a existir. En Warp con un tema azulado la app entera se veía turquesa.
    <box style={{ flexDirection: "column", flexGrow: 1, backgroundColor: C.bg }}>
      {/* Cabecera: identidad y capacidades. La placa `REV` de la derecha es de
          manual industrial, no adorno — dice qué versión estás mirando.
          El estado del enlace NO va acá: vive en el panel de topología, que es
          de lo que habla. Dos indicadores del mismo dato compiten. */}
      <box style={{ paddingLeft: 1, paddingRight: 1 }}>
        <Hud
          segments={[
            { text: "PACKETSMITH", fg: C.fg },
            { text: props.engine.name.toUpperCase() },
            // El motor ya dijo "CLAUDE"; repetirlo en el modelo daba
            // "CLAUDE ▏ CLAUDE-OPUS-5", que ocupa el doble y no dice más.
            { text: model().toUpperCase().replace(/^CLAUDE-/, "") },
            { text: `${toolCount()} TOOLS` },
          ]}
          tail={{ text: `REV ${REV}` }}
        />
      </box>
      <Hairline />

      {/* Las dos zonas no llevan marco propio: las separa una canaleta y un
          fondo apenas distinto. Dos rectángulos anidados leían como formulario,
          no como consola. */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Chat turns={turns()} streaming={streaming()} busy={busy()} liveTools={live()} />
        <Canvas topology={topology()} lastTool={lastTool()} live={bridgeLive()} />
      </box>

      <Hairline />
      {/* La cuña `▌` marca dónde escribís, y se enciende solo cuando el turno es
          tuyo: mientras el agente trabaja no hay nada que escribir. */}
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text style={{ fg: busy() ? C.rule : C.fg, flexShrink: 0 }}>{"▌ "}</text>
        <input
          focused
          value={draft()}
          placeholder={busy() ? "el agente está trabajando…" : "describí la red que querés"}
          onInput={setDraft}
          onSubmit={submit}
        />
      </box>

      {/* Barra de estado: lo que cambia en vivo va acá abajo, lejos del texto,
          para que el ojo no tenga que competir con la conversación. El barrido
          de la derecha reemplaza al spinner — ocupa el ancho del aparato en vez
          de un carácter, que es la diferencia entre "algo pasa" y telemetría. */}
      <box style={{ paddingLeft: 1, paddingRight: 1 }}>
        <Hud
          segments={[
            { text: `${turns().length} TURNS` },
            { text: `${topology().devices.length} NODES` },
            { text: `${topology().links.length} LINKS` },
            { text: `$${cost().toFixed(4)}` },
          ]}
          tail={busy() ? { text: sweep(14, tick()), fg: C.fg } : { text: "IDLE", fg: C.rule }}
          phase={37}
        />
      </box>
    </box>
  )
}
