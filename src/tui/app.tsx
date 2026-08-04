// Composición y estado. Acá vive el ciclo: input → sesión → eventos → UI.
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { homedir } from "node:os"
import type { Engine, Limits, Phase, Session, Usage } from "../engine/types.ts"
import { pollQuota, type Quota } from "../engine/quota.ts"
import { isConfigured } from "../engine/mcp.ts"
import type { Topology } from "../topology/model.ts"
import { EMPTY, ingest } from "../topology/ingest.ts"
import { Chat, shortToolName, type Turn } from "./chat.tsx"
import { Canvas, WIDTH as PANEL_WIDTH } from "./canvas.tsx"
import { Prompt } from "./prompt.tsx"
import { Activity } from "./activity.tsx"
import { C } from "./theme.ts"
import { Gauge, Hairline, Hud } from "./frame.tsx"

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

/** Cada cuánto late el indicador de actividad, en milisegundos. */
const BEAT_MS = 120

/**
 * Firma de la disposición de la red.
 *
 * El plano se adjunta solo al turno que la CAMBIÓ: repetirlo en cada respuesta
 * lo volvería papel tapiz y dejaría de mirarse. La firma incluye las
 * coordenadas porque mover un equipo en PT sin agregar ninguno también es un
 * cambio de disposición, y es exactamente lo que el plano existe para mostrar.
 */
export function layoutKey(topo: Topology): string {
  return topo.devices.map((d) => `${d.name}@${d.x},${d.y}`).join("|") + `#${topo.links.length}`
}

/**
 * Si vale la pena dibujar el plano.
 *
 * Sin enlaces no hay forma que mostrar, y sin coordenadas tampoco:
 * `pt_query_topology` devuelve todos los equipos en (0,0) y el plano saldría
 * como una sola celda con catorce nodos encima.
 */
export function worthMapping(topo: Topology): boolean {
  return topo.devices.length >= 2 &&
    topo.links.length > 0 &&
    topo.devices.some((d) => d.x !== 0 || d.y !== 0)
}

/** `1 TURNO`, `2 TURNOS`. Un "1 TURNOS" delata que nadie miró la pantalla. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "S"}`
}

/** `five_hour` → `5H`. La etiqueta larga no entra y no aporta. */
export function windowLabel(window: string): string {
  const m = /^(\w+?)_(hour|day)$/.exec(window)
  if (!m) return window.toUpperCase()
  const n: Record<string, string> = { one: "1", five: "5", seven: "7" }
  return `${n[m[1]!] ?? m[1]!}${m[2] === "hour" ? "H" : "D"}`
}

/**
 * Cuánto falta para que la ventana de cuota se reinicie.
 *
 * El CLI da el instante del reinicio, no el porcentaje consumido. La cuenta
 * regresiva es lo que se puede derivar de eso y es la mitad útil del dato: con
 * el tope cerca, saber si faltan diez minutos o tres horas decide si conviene
 * seguir ahora o después.
 */
export function untilReset(resetsAt: number, now: number): string {
  const mins = Math.round((resetsAt * 1000 - now) / 60_000)
  if (mins <= 0) return ""
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`
}

/** Chip de cuota. El color solo aparece cuando hay algo que decidir. */
export function limitChip(l: Limits, now = Date.now()): { text: string; fg: string } {
  const mark = l.status === "allowed" ? "✓" : l.status === "rejected" ? "✗" : "⚠"
  const fg = l.status === "allowed" ? C.dim : l.status === "rejected" ? C.alert : C.warn
  const left = untilReset(l.resetsAt, now)
  return { text: `${windowLabel(l.window)} ${mark}${left ? ` ${left}` : ""}`, fg }
}

/**
 * Color de un porcentaje consumido.
 *
 * Los umbrales son de decisión, no de estética: en 80 todavía te da para el
 * turno que ibas a hacer, en 95 conviene guardar y esperar el reinicio. Debajo
 * de 80 no hay nada que decidir, así que no lleva color.
 */
export function pctColor(pct: number): string {
  if (pct >= 95) return C.alert
  if (pct >= 80) return C.warn
  return C.dim
}

export function App(props: {
  engine: Engine
  model?: string
  /** Ancho de la terminal. Solo para preview y tests, que dibujan a un buffer. */
  columns?: number
  /** Cuota fija en vez de consultarla. Idem: evita tocar el Keychain. */
  quota?: Quota
}) {
  const [turns, setTurns] = createSignal<Turn[]>([])
  const [streaming, setStreaming] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [topology, setTopology] = createSignal<Topology>(EMPTY)
  const [lastTool, setLastTool] = createSignal<string>()
  const [model, setModel] = createSignal(props.model ?? "…")
  const [cost, setCost] = createSignal(0)
  const [toolCount, setToolCount] = createSignal(0)
  // Enlace con Packet Tracer: se deduce de si la ultima pt_* respondio bien.
  // Es el unico dato binario que importa de un vistazo, y el unico verde.
  const [bridgeLive, setBridgeLive] = createSignal(false)

  // Qué está haciendo el agente. Lo dice el CLI; no se deduce del silencio.
  const [phase, setPhase] = createSignal<Phase>("idle")
  const [phaseDetail, setPhaseDetail] = createSignal<string>()
  const [thinking, setThinking] = createSignal(0)
  const [usage, setUsage] = createSignal<Usage>()
  const [limits, setLimits] = createSignal<Limits>()

  // El latido va con reloj, no con los eventos. Suena a detalle y no lo es: el
  // tramo que hay que cubrir es el SILENCIOSO —pedido en vuelo, razonamiento
  // sin texto—, y ahí no llega ningún evento que pueda mover un contador.
  const [beat, setBeat] = createSignal(0)
  const [startedAt, setStartedAt] = createSignal(0)
  const [elapsed, setElapsed] = createSignal(0)

  createEffect(() => {
    if (phase() === "idle") return
    const id = setInterval(() => {
      setBeat((b) => b + 1)
      setElapsed(Date.now() - startedAt())
    }, BEAT_MS)
    onCleanup(() => clearInterval(id))
  })

  // Reloj lento, solo para la cuenta regresiva de la cuota. Sin él el número se
  // congela cuando la sesión queda quieta, que es justo cuando el tiempo pasa.
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => clearInterval(id))
  })

  // Porcentaje de plan consumido. No viene en el stream: hay que pedírselo a
  // Anthropic con el token que el CLI ya guardó.
  //
  // Se apaga con PACKETSMITH_NO_QUOTA para quien no quiera que la app toque su
  // Keychain, y con `props.quota` para el preview: montarlo abriría el diálogo
  // de permisos del sistema, y un preview no tiene por qué pedirle permiso a
  // nadie.
  const [quota, setQuota] = createSignal<Quota | undefined>(props.quota)
  onMount(() => {
    if (props.quota || props.engine.name !== "claude" || process.env.PACKETSMITH_NO_QUOTA) return
    const stop = pollQuota(homedir(), setQuota)
    onCleanup(stop)
  })

  let session: Session | undefined
  // Disposición del último plano dibujado, para no repetirlo turno tras turno.
  let mapped = ""
  // Si el MCP está registrado. Se mira UNA vez, al arrancar: es config del
  // disco, no cambia mientras la app corre, y es la única dependencia que la
  // app no puede resolver sola.
  const mcpReady = isConfigured(homedir(), process.cwd())
  // Cronometraje del turno: cuándo arrancó cada tool y cuánto sumaron todas.
  const openedAt = new Map<string, number>()
  let toolMs = 0
  // Tools del turno en curso, como signal para que el panel las muestre
  // mientras corren en vez de recién al cerrar el turno.
  const [live, setLive] = createSignal<NonNullable<Turn["tools"]>>([])

  // Ancho de la terminal. El plano tiene que entrar exacto: recortarlo le corta
  // nodos, y esta versión de OpenTUI no expone el tamaño desde un componente.
  // `props.columns` existe para el preview y los tests, que renderizan a un
  // buffer de un ancho que no tiene nada que ver con el de la terminal real.
  const [cols, setCols] = createSignal(props.columns ?? process.stdout.columns ?? 100)
  onMount(() => {
    if (props.columns) return
    const onResize = () => setCols(process.stdout.columns || 100)
    process.stdout.on("resize", onResize)
    onCleanup(() => void process.stdout.off("resize", onResize))
  })

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

        case "phase":
          setPhase(ev.phase)
          setPhaseDetail(ev.detail ? shortToolName(ev.detail) : undefined)
          // Los tokens de razonamiento son POR TRAMO: si no se reiniciaran, el
          // segundo bloque de thinking arrancaría desde donde quedó el primero
          // y el contador diría cualquier cosa.
          if (ev.phase === "thinking") setThinking(0)
          break

        case "thinking":
          setThinking(ev.tokens)
          break

        case "limits":
          setLimits(ev.limits)
          break

        case "text":
          setStreaming((t) => t + ev.delta)
          break

        case "tool_start":
          // El instante se guarda por id: dos llamadas a la misma tool pueden
          // solaparse, y emparejarlas por nombre le daría a una el tiempo de
          // la otra.
          openedAt.set(ev.id, Date.now())
          setLive((l) => [...l, { id: ev.id, name: ev.name, done: false, isError: false }])
          break

        case "tool_end": {
          const started = openedAt.get(ev.id)
          openedAt.delete(ev.id)
          const ms = started ? Date.now() - started : 0
          toolMs += ms

          setLive((l) => {
            const i = l.findIndex((x) => (x.id ? x.id === ev.id : x.name === ev.name && !x.done))
            if (i === -1) return l
            const copy = [...l]
            copy[i] = { ...copy[i]!, done: true, isError: ev.isError, ms }
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
          if (ev.usage) setUsage(ev.usage)

          const topo = topology()
          const key = layoutKey(topo)
          const map = worthMapping(topo) && key !== mapped ? topo : undefined
          if (map) mapped = key

          // Solo hay tiempo que informar si el turno arrancó con un mensaje
          // nuestro. Sin esa marca, `Date.now() - 0` da la edad del epoch y la
          // línea mostraba "29764558m36s" con toda seriedad.
          const timing = startedAt()
            ? { totalMs: Date.now() - startedAt(), toolMs }
            : undefined

          setTurns((t) => [...t, {
            role: "agent",
            text: ev.text || streaming(),
            tools,
            ...(timing ? { timing } : {}),
            ...(map ? { map } : {}),
          }])
          toolMs = 0
          openedAt.clear()
          setStreaming("")
          setBusy(false)
          setPhase("idle")
          break
        }

        case "error":
          setTurns((t) => [...t, { role: "agent", text: `⚠ ${ev.message}`, tools: live() }])
          setLive([])
          setStreaming("")
          setBusy(false)
          setPhase("idle")
          break
      }
    }
  }

  function submit(text: string) {
    if (!session) return
    setTurns((t) => [...t, { role: "user", text }])
    setBusy(true)
    setStreaming("")
    // El reloj arranca acá y no al primer evento: lo que se quiere medir es
    // cuánto llevás esperando vos, que empieza al apretar Enter.
    setStartedAt(Date.now())
    setElapsed(0)
    setPhase("requesting")
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
            // El nombre es lo único de marca en la cabecera. El resto son
            // datos, y los datos no llevan color de marca.
            { text: "PACKETSMITH", fg: C.brand },
            { text: props.engine.name.toUpperCase(), fg: C.fg },
            // El motor ya dijo "CLAUDE"; repetirlo en el modelo daba
            // "CLAUDE ▏ CLAUDE-OPUS-5", que ocupa el doble y no dice más.
            { text: model().toUpperCase().replace(/^CLAUDE-/, "") },
            { text: `${toolCount()} TOOLS` },
          ]}
          tail={<text style={{ fg: C.dim }}>{`REV ${REV}`}</text>}
        />
      </box>
      <Hairline />

      {/* Las dos zonas no llevan marco propio: las separa una canaleta y un
          fondo apenas distinto. Dos rectángulos anidados leían como formulario,
          no como consola. */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Chat
          turns={turns()}
          streaming={streaming()}
          busy={busy()}
          liveTools={live()}
          live={bridgeLive()}
          mcp={mcpReady}
          // Lo que sobra después del panel, los márgenes del chat y la canaleta
          // del mensaje. Si sobra menos de 30 el plano no se dibuja: mejor nada
          // que un plano con nodos cortados.
          mapWidth={cols() - PANEL_WIDTH - 6}
        />
        <Canvas topology={topology()} lastTool={lastTool()} live={bridgeLive()} />
      </box>

      <Hairline />
      {/* Barra de estado ARRIBA del campo de escritura: lo que informa va junto
          a la conversación, y el campo queda último, que es donde está el
          cursor y donde el ojo vuelve solo después de leer. */}
      <box style={{ paddingLeft: 1, paddingRight: 1 }}>
        <Hud
          lead={
            <Activity
              phase={phase()}
              detail={phaseDetail()}
              thinking={thinking()}
              elapsedMs={elapsed()}
              beat={beat()}
            />
          }
          segments={[
            { text: plural(turns().length, "TURNO") },
            { text: plural(topology().devices.length, "NODO") },
            { text: `$${cost().toFixed(4)}` },
          ]}
          tail={<Budget usage={usage()} limits={limits()} quota={quota()} now={now()} />}
        />
      </box>

      {/* Los atajos NO van acá: los enseña la pantalla de arranque, que es
          donde uno los lee. Repetirlos en el placeholder los convierte en
          ruido permanente en la línea donde se escribe. */}
      <Prompt
        busy={busy()}
        placeholder={busy() ? "el agente está trabajando…" : "describí la red que querés"}
        onSubmit={submit}
      />
    </box>
  )
}

/**
 * Cuánto te queda: contexto ocupado y cuota del plan.
 *
 * Son la misma pregunta hecha a dos plazos, y en una sesión larga con varios
 * deploys son lo que decide si conviene seguir acá o arrancar de nuevo. Los dos
 * datos ya venían en el stream del CLI —`usage` y `rate_limit_event`— sin que
 * hubiera que leer el token de OAuth ni pegarle a ningún endpoint aparte.
 */
function Budget(props: { usage?: Usage; limits?: Limits; quota?: Quota; now: number }) {
  const ctx = () => (props.usage ? props.usage.tokens / props.usage.contextWindow : 0)
  const chip = () => (props.limits ? limitChip(props.limits, props.now) : undefined)
  // La etiqueta de la ventana sale del stream; el porcentaje, del endpoint. Si
  // el stream todavía no dijo cuál es la ventana, `5H` es la del plan estándar.
  const win = () => (props.limits ? windowLabel(props.limits.window) : "5H")

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <Show when={props.usage}>
        <text style={{ fg: C.rule }}>
          {"CTX "}
          <Gauge fraction={ctx()} />
          <span style={{ fg: C.dim }}>{` ${Math.round(ctx() * 100)}%`}</span>
        </text>
      </Show>

      {/* Con el porcentaje real, el medidor REEMPLAZA al chip de estado: dice
          lo mismo y más. El chip vuelve solo si el endpoint no contestó. */}
      <Show
        when={props.quota?.session !== undefined}
        fallback={
          <Show when={chip()}>
            <text style={{ fg: chip()!.fg }}>{`   ${chip()!.text}`}</text>
          </Show>
        }
      >
        <text style={{ fg: C.rule }}>
          {`   ${win()} `}
          {/* La parte llena toma el color del estado: cerca del tope la barra
              se enciende sola y no hay que leer el número para saberlo. */}
          <Gauge
            fraction={props.quota!.session! / 100}
            fg={pctColor(props.quota!.session!)}
          />
          <span style={{ fg: pctColor(props.quota!.session!) }}>
            {` ${Math.round(props.quota!.session!)}%`}
          </span>
        </text>
        {/* La semanal va sin barra: es contexto, no la que te corta el turno. */}
        <Show when={props.quota?.weekly !== undefined}>
          <text style={{ fg: C.rule }}>
            {"   7D "}
            <span style={{ fg: pctColor(props.quota!.weekly!) }}>
              {`${Math.round(props.quota!.weekly!)}%`}
            </span>
          </text>
        </Show>
      </Show>
    </box>
  )
}
