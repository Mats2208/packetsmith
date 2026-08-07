/** @jsxImportSource @opentui/solid */
// Composición y estado. Acá vive el ciclo: input → sesión → eventos → UI.
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import type { Effort, Engine, Limits, Phase, Session, Usage } from "../engine/types.ts"
import { engines } from "../engine/index.ts"
import { pollQuota, type Quota } from "../engine/quota.ts"
import { isConfigured } from "../engine/mcp.ts"
import type { Topology } from "../topology/model.ts"
import { EMPTY, ingest } from "../topology/ingest.ts"
import { Chat, shortToolName, type Turn } from "./chat.tsx"
import { Canvas, WIDTH as PANEL_WIDTH } from "./canvas.tsx"
import { Prompt } from "./prompt.tsx"
import { Activity } from "./activity.tsx"
import { C, setTheme, theme } from "./theme.ts"
import { idioma, setIdioma, T, type Lang } from "./i18n.ts"
import { Gauge, Hairline, Hud } from "./frame.tsx"
import { dialog, hayDialogo, Picker, registrarPaleta } from "./picker.tsx"
import { comandoPorTitulo, findCommand, opcionesDeComandos, type CommandCtx } from "./commands.ts"
import { aplicarEfectos } from "./effects.ts"
import { limpiarPestana, ponerProgreso, ponerTitulo } from "./titulo.ts"
import { guardarModelo, modeloDe, saveConfig } from "../config.ts"
import pkg from "../../package.json" with { type: "json" }
import { hayCredencial, planElegido, setApiKey, setOauth, setPlan } from "../auth.ts"
import { iniciarLogin } from "../engine/providers/oauth-chatgpt.ts"

/** Solo las tools del MCP de Packet Tracer alimentan el panel derecho. */
const PT_TOOL = /(^|__)pt_/

/** Va en la placa de la cabecera. Se sube a mano con cada release. */
// La versión sale del `package.json` y no de una constante acá: escrita a mano
// se desincroniza sin que nada falle, y una cabecera que dice una versión
// distinta de la publicada es peor que no decir ninguna.
const REV = pkg.version.split(".").slice(0, 2).join(".")

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

/** La conversación y la red, en markdown, para `/export`. */
export function transcripcion(turns: Turn[], topo: Topology): string {
  const red = topo.devices.length
    ? ["", "## Red", "", "| equipo | modelo | posición | direcciones |", "|---|---|---|---|",
       ...topo.devices.map((d) =>
         `| ${d.name} | ${d.model} | ${d.x},${d.y} | ` +
         `${d.ports.filter((p) => p.ip).map((p) => p.ip!.split("/")[0]).join(", ") || "—"} |`),
       "", `${topo.links.length} enlaces:`, "",
       ...topo.links.map((l) =>
         `- ${l.a.device}:${l.a.port}${l.b ? ` ↔ ${l.b.device}:${l.b.port}` : " ))) inalámbrico"}`)]
    : []

  return [
    `# PacketSmith — ${new Date().toISOString()}`,
    "",
    ...turns.map((t) => `**${t.role === "user" ? "VOS" : "AGENTE"}**\n\n${t.text}\n`),
    ...red,
    "",
  ].join("\n")
}

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
  effort?: Effort
  /** Ancho de la terminal. Solo para preview y tests, que dibujan a un buffer. */
  columns?: number
  /** Cuota fija en vez de consultarla. Idem: evita tocar el Keychain. */
  quota?: Quota
}) {
  // El renderer hace falta para tres cosas que no son de dibujo: salir, copiar
  // al portapapeles y encender los efectos. Se pide una vez acá porque solo se
  // consigue desde adentro de un componente.
  const renderer = useRenderer()
  const [turns, setTurns] = createSignal<Turn[]>([])
  const [streaming, setStreaming] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [topology, setTopology] = createSignal<Topology>(EMPTY)
  const [lastTool, setLastTool] = createSignal<string>()
  // `undefined` y no "…": los puntos suspensivos son lo que se DIBUJA cuando no
  // se sabe, no un valor. Guardados acá, `model() || modelPedido()` se quedaba
  // con ellos para siempre —una cadena no vacía gana el `||`— y la cabecera
  // decía `MODEL …` aunque acabaras de elegir uno.
  const [model, setModel] = createSignal<string | undefined>(props.model)
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

  // El título de la pestaña. Se cuelga de la fase porque lo que uno quiere
  // saber mirando la pestaña desde otra pestaña es si el agente ya terminó.
  //
  // `props.columns` lo apaga por la misma razón que apaga el `resize`: el
  // preview y los tests dibujan a un búfer, y una secuencia de escape escrita
  // ahí no la ve nadie pero ensucia la terminal de quien corre `bun test`.
  createEffect(() => {
    if (props.columns) return
    const trabajando = phase() !== "idle"
    ponerTitulo(trabajando ? T.fases[phase()].toLowerCase() : undefined)
    // El mismo dato por la otra vía: con la ventana minimizada o en otra
    // pestaña, el título no se lee y el ícono sí.
    ponerProgreso(trabajando)
  })
  onCleanup(limpiarPestana)

  // Reloj lento, solo para la cuenta regresiva de la cuota. Sin él el número se
  // congela cuando la sesión queda quieta, que es justo cuando el tiempo pasa.
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => clearInterval(id))
  })

  // Lo que se le pide al motor. Son señales porque `/model` y `/effort` las
  // cambian en caliente, y la cabecera tiene que reflejarlo enseguida.
  const [motor, setMotor] = createSignal(props.engine)
  const [modelPedido, setModelPedido] = createSignal(props.model)
  const [effort, setEffort] = createSignal<Effort>(props.effort ?? "medium")
  const [sessionId, setSessionId] = createSignal("")
  const [efectosOn, setEfectosOn] = createSignal(false)

  // ── Medidor de plan ───────────────────────────────────────────────────────
  //
  // Cuánto llevás consumido. No viene en el stream de nadie: hay que
  // preguntárselo al proveedor, y cada uno lo publica a su manera.
  //
  // Va en un `createEffect` sobre `motor()` y NO en `onMount`, que es lo que
  // era: montado una sola vez, el medidor se quedaba con el número del primer
  // motor para siempre. Con Kimi arrancaba bien, cambiabas a Claude, y la barra
  // seguía mostrando el consumo de Kimi — que es peor que no mostrar nada,
  // porque parece un dato.
  //
  // Se apaga con PACKETSMITH_NO_QUOTA para quien no quiera que la app toque su
  // Keychain, y con `props.quota` para el preview: montarlo abriría el diálogo
  // de permisos del sistema, y un preview no tiene por qué pedirle permiso a
  // nadie.
  const [quota, setQuota] = createSignal<Quota | undefined>(props.quota)
  // Etiqueta de la ventana corta. La dice el proveedor: Kimi informa 300
  // minutos, Claude `five_hour`. Asumir `5H` para todos sería inventar.
  const [ventana, setVentana] = createSignal<string | undefined>(undefined)

  createEffect(() => {
    const m = motor()
    if (props.quota || process.env.PACKETSMITH_NO_QUOTA) return

    // Lo del motor anterior se borra ANTES de pedir lo nuevo. Dejarlo mientras
    // llega la respuesta muestra el consumo de otro plan como si fuera de este.
    setQuota(undefined)
    setVentana(undefined)

    if (m.name === "claude") {
      const stop = pollQuota(homedir(), setQuota)
      onCleanup(stop)
      return
    }

    // Los demás lo publican cada uno a su manera y el motor lo normaliza. Se
    // pide al arrancar y cada cinco minutos: son ventanas de horas, sondearlo
    // más seguido es gastar pedidos para ver el mismo número.
    let vivo = true
    const pedir = () => {
      m.uso?.().then((u) => {
        if (!vivo || !u) return
        setVentana(u.ventana)
        setQuota({
          ...(u.sesion !== undefined ? { session: u.sesion } : {}),
          ...(u.semanal !== undefined ? { weekly: u.semanal } : {}),
        })
      }).catch(() => {})
    }
    pedir()
    const id = setInterval(pedir, 5 * 60_000)
    onCleanup(() => { vivo = false; clearInterval(id) })
  })


  /**
   * Quién contesta, para la cabecera.
   *
   * Sale del motor Y de su plan: con Kimi conectado por suscripción decir solo
   * `KIMI` esconde que hay dos puertas con precios distintos.
   */
  const etiquetaProveedor = () => {
    const nombre = motor().name.toUpperCase()
    const plan = motor().planActual?.()
    return plan ? `${nombre}/${plan.toUpperCase()}` : nombre
  }

  /**
   * Qué modelo, de verdad.
   *
   * El que informó el motor en `ready` GANA sobre el que le pedimos: si le
   * pedimos uno que no tiene, queremos ver el que usó y no el que quisimos.
   * Mientras no llegó ese evento se muestra el pedido, y si no hay ninguno, `…`.
   */
  const etiquetaModelo = () =>
    (model() || modelPedido() || "…").toUpperCase().replace(/^CLAUDE-/, "")

  /**
   * Cuánto razona. Va en la cabecera porque cambia lo que pagás y lo que tardás.
   *
   * Estaba solo en `/debug`: elegías `xhigh`, la app tardaba el triple y no
   * había nada en pantalla que lo explicara.
   */
  const etiquetaEsfuerzo = () => effort().toUpperCase()

  // Lee el campo de escritura EN EL MOMENTO. Lo pone `Prompt` al montarse. La
  // paleta lo consulta para saber si una `/` abre la lista o es solo una barra
  // en el medio de una frase; una señal actualizada por `onContentChange`
  // llegaba tarde, porque ese evento se dispara al terminar el lote de entrada.
  let leerBorrador: () => string = () => ""

  let session: Session | undefined
  // Generación de la sesión. Al cambiar de modelo se levanta un proceso nuevo y
  // el viejo todavía tiene su iterador andando: sin esto, su evento de cierre
  // llegaba como un error del agente y ensuciaba el chat de la sesión nueva.
  let generacion = 0
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

  /**
   * Levanta una sesión. Con `resume` conserva la conversación anterior.
   *
   * Es lo que hace que cambiar de modelo no cueste el contexto: el modelo y el
   * esfuerzo son argumentos de arranque del CLI, así que no se pueden cambiar
   * en vivo, pero `--resume` deja levantar otro proceso sobre la misma sesión.
   * Verificado contra el CLI real: con haiku se le da un dato, se relanza con
   * sonnet, y lo recuerda.
   */
  function arrancar(resume?: string) {
    session?.close()
    const mia = ++generacion
    const s = motor().start({
      model: modelPedido(),
      effort: effort(),
      lang: idioma(),
      ...(resume ? { resume } : {}),
    })
    session = s
    void consume(s, mia)
  }

  onMount(() => arrancar())
  onCleanup(() => session?.close())

  async function consume(s: Session, mia: number) {
    for await (const ev of s.events()) {
      // Los eventos de una sesión que ya reemplazamos se descartan.
      if (mia !== generacion) continue
      switch (ev.type) {
        case "ready":
          setModel(ev.model)
          setToolCount(ev.tools.length)
          setSessionId(ev.sessionId)
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

  /** Una respuesta de la app, sin gastar un turno del agente. */
  const decir = (text: string) => setTurns((t) => [...t, { role: "agent", text }])

  // El contexto que reciben los comandos. Es una interfaz y no la app entera a
  // propósito: así `commands.ts` se testea sin montar nada.
  const ctx: CommandCtx = {
    decir,
    pedir(texto, etiqueta) {
      setTurns((t) => [...t, { role: "user", text: etiqueta }])
      if (!session?.send(texto)) { decir(T.sesionMuerta); return }
      setBusy(true)
      setStreaming("")
      setStartedAt(Date.now())
      setElapsed(0)
      setPhase("requesting")
    },
    reiniciar(cambios) {
      if (cambios.model) setModelPedido(cambios.model)
      if (cambios.effort) setEffort(cambios.effort)
      // Se guarda lo elegido: si tuviste que entrar acá a cambiarlo, la próxima
      // vez lo vas a querer igual.
      if (modelPedido()) guardarModelo(motor().name, modelPedido()!)
      saveConfig({ effort: effort() })
      // Se reanuda si ya hubo sesión: cambiar de modelo no tiene por qué
      // costarte la conversación.
      arrancar(sessionId() || undefined)
      decir(T.ahoraModelo(modelPedido() ?? "default", effort(), Boolean(sessionId())))
    },
    limpiar() {
      setTurns([])
      setTopology(EMPTY)
      setStreaming("")
      setLive([])
      setCost(0)
      setUsage(undefined)
      setSessionId("")
      mapped = ""
      arrancar()
    },
    salir: () => renderer?.destroy(),
    // OSC52: el terminal copia por vos, así que anda igual sobre SSH. Devuelve
    // false solo, sin excepción, cuando el terminal no lo soporta.
    copiar: (texto) => renderer?.copyToClipboardOSC52(texto) ?? false,
    exportar() {
      const dir = join(homedir(), ".packetsmith")
      mkdirSync(dir, { recursive: true })
      // El nombre lleva la marca de tiempo para no pisar el anterior: exportar
      // dos veces y quedarse con una sola sería la peor sorpresa posible.
      const ruta = join(dir, `sesion-${new Date().toISOString().replace(/[:.]/g, "-")}.md`)
      writeFileSync(ruta, transcripcion(turns(), topology()))
      return ruta
    },
    // El tema NO se guarda al previsualizar, solo al confirmar: si no, salir
    // con Esc te dejaba guardado el que estabas mirando de paso.
    cambiarMotor(nombre) {
      const e = engines[nombre as keyof typeof engines]
      if (!e || e === motor()) return
      setMotor(e)
      // Modelo y sesión son del motor viejo: los alias de Claude no existen en
      // Kimi, y el id de sesión tampoco. Se empieza limpio.
      // El modelo es del motor viejo. Se recupera el que se haya elegido para
      // el nuevo, si hubo, y si no arranca con el suyo por defecto.
      setModelPedido(modeloDe(nombre))
      setModel(modeloDe(nombre))
      setSessionId("")
      setToolCount(0)
      arrancar()
      saveConfig({ engine: nombre })
    },
    modelosDelMotor: () => motor().models?.() ?? [],
    guardarKey: (provider, plan, key) => setApiKey(provider, key, plan),
    // Devuelve SI hay credencial, nunca cuál. No sale de `auth.ts`.
    hayKey: (provider) => hayCredencial(provider),
    planDe: (provider) => planElegido(provider),
    medidor: () => motor().uso?.() ?? Promise.resolve(undefined),
    conectarChatGPT(provider, plan, mostrar) {
      // El plan queda anotado ANTES de que termine el login: si se cancela a
      // mitad, `/connect` vuelve a abrir en el plan que se estaba intentando y
      // no en el primero de la lista.
      setPlan(provider, plan)
      iniciarLogin()
        .then((login) => {
          mostrar(login.url, login.codigo)
          return login.esperar().then((t) => {
            if (!setOauth(provider, t, plan)) { decir(T.noSePudoGuardar); return }
            decir(T.loginListo(provider))
          })
        })
        .catch((e) => decir(T.loginFallo(e instanceof Error ? e.message : String(e))))
    },
    idioma: {
      actual: idioma,
      poner(l) {
        if (!setIdioma(l) ) return
        saveConfig({ language: l as Lang })
        // Relanza sobre la misma sesión: el idioma viaja en el prompt de
        // sistema, que es argumento de arranque. Sin esto la interfaz cambiaba
        // y el agente seguía contestando en el otro idioma.
        arrancar(sessionId() || undefined)
      },
    },
    tema: {
      actual: () => theme().name,
      poner: (n) => void setTheme(n),
      confirmar: (n) => { setTheme(n); saveConfig({ theme: n }) },
    },
    efectos: {
      activos: efectosOn,
      alternar() {
        const nuevo = renderer ? aplicarEfectos(renderer, !efectosOn()) : false
        setEfectosOn(nuevo)
        return nuevo
      },
    },
    estado: () => ({
      engine: motor().name,
      // El que informó el motor, o el que le pedimos: `/model` marca el que
      // está en uso comparando contra esto, y con el motor recién cambiado
      // todavía no llegó el `ready` que lo confirma.
      model: model() ?? modelPedido() ?? "",
      effort: effort(),
      sessionId: sessionId(),
      motor: motor().describe?.() ?? {},
      mcp: mcpReady,
      bridge: bridgeLive(),
      nodos: topology().devices.length,
      enlaces: topology().links.length,
      turnos: turns().length,
      costoUsd: cost(),
      ultimaRespuesta: [...turns()].reverse().find((t) => t.role === "agent")?.text ?? "",
      motores: Object.keys(engines),
    }),
  }

  // La paleta la arma la app porque los comandos son suyos; `picker.tsx` solo
  // sabe dibujar una lista y atender el teclado.
  registrarPaleta(() => dialog.abrir({
    titulo: T.tituloComandos,
    prefijo: "/",
    opciones: opcionesDeComandos(),
    onElegir: (o) => findCommand(o.value)?.run(ctx),
  }))

  function submit(text: string) {
    if (!session) return

    // Un `/comando` tipeado entero también corre, sin pasar por la lista: es
    // más rápido cuando ya sabés cuál querés.
    const directo = comandoPorTitulo(text)
    if (directo) { directo.run(ctx); return }

    setTurns((t) => [...t, { role: "user", text }])

    // Si el CLI ya murió, el mensaje no llega a ningún lado. Antes se mandaba
    // igual —escribir en el stdin de un proceso muerto no tira—, la app se
    // ponía en "trabajando", y se quedaba así para siempre: sin eventos que
    // esperar, nada volvía a poner `busy` en falso y el campo de escritura
    // quedaba bloqueado. Decirlo y no bloquear nada es todo lo que hace falta.
    if (!session.send(text)) { decir(T.sesionMuerta); return }

    setBusy(true)
    setStreaming("")
    // El reloj arranca acá y no al primer evento: lo que se quiere medir es
    // cuánto llevás esperando vos, que empieza al apretar Enter.
    setStartedAt(Date.now())
    setElapsed(0)
    setPhase("requesting")
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
      <box style={{ paddingLeft: 1, paddingRight: 1, height: 1, flexShrink: 0 }}>
        <Hud
          segments={[
            // El nombre es lo único de marca en la cabecera. El resto son
            // datos, y los datos no llevan color de marca.
            { text: "PACKETSMITH", fg: C.brand },
            // Proveedor y modelo van ETIQUETADOS y no sueltos. Sin etiqueta se
            // leían como una sola cosa, y cuando el modelo quedaba viejo la
            // cabecera decía "KIMI · SONNET" sin que nada delatara el error.
            { text: `PROVIDER ${etiquetaProveedor()}`, fg: C.fg },
            { text: `MODEL ${etiquetaModelo()}` },
            { text: `EFFORT ${etiquetaEsfuerzo()}` },
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
      <box style={{ paddingLeft: 1, paddingRight: 1, height: 1, flexShrink: 0 }}>
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
            { text: T.turnos(turns().length) },
            { text: T.nodosBarra(topology().devices.length) },
            // Un motor de suscripción no cobra por token: el peso marcaría
            // `$0.0000` toda la sesión, que se lee como contador roto.
            ...(motor().sinCostoPorToken ? [] : [{ text: `$${cost().toFixed(4)}` }]),
          ]}
          tail={
            <Budget
              usage={usage()}
              limits={limits()}
              quota={quota()}
              ventana={ventana()}
              now={now()}
            />
          }
        />
      </box>

      {/* La paleta va ENTRE la barra de estado y el campo de escritura: queda
          justo sobre el cursor, que es donde el ojo ya está. No puede ir
          después de un scrollbox — en esta versión de OpenTUI el scrollbox se
          queda con todo el alto que sobra y lo de después nunca se dibuja. */}
      <Picker draftVacio={() => !leerBorrador().trim()} ancho={cols} />

      {/* Los atajos NO van acá: los enseña la pantalla de arranque, que es
          donde uno los lee. Repetirlos en el placeholder los convierte en
          ruido permanente en la línea donde se escribe. */}
      <Prompt
        busy={busy()}
        placeholder={busy() ? T.trabajando : T.describiLaRed}
        onSubmit={submit}
        onReady={(leer) => (leerBorrador = leer)}
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
function Budget(props: {
  usage?: Usage; limits?: Limits; quota?: Quota; ventana?: string; now: number
}) {
  const ctx = () => (props.usage ? props.usage.tokens / props.usage.contextWindow : 0)
  const chip = () => (props.limits ? limitChip(props.limits, props.now) : undefined)
  // La etiqueta de la ventana sale del stream; el porcentaje, del endpoint. Si
  // el stream todavía no dijo cuál es la ventana, `5H` es la del plan estándar.
  // La etiqueta la dice quien la sepa: el proveedor HTTP la manda medida, el
  // CLI la manda por nombre. `5H` solo si ninguno de los dos habló todavía.
  const win = () => props.ventana ?? (props.limits ? windowLabel(props.limits.window) : "5H")

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <Show when={props.usage}>
        <text style={{ fg: C.dim }}>
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
        <text style={{ fg: C.dim }}>
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
          <text style={{ fg: C.dim }}>
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
