// Los textos de la interfaz, en los dos idiomas.
//
// Estaba todo en castellano y quedaba raro: los comandos son `/model` y
// `/theme`, el panel dice `BRIDGE UP` y `awaiting deployment`, y en el medio la
// bienvenida decía "probá con". Media interfaz en cada idioma no es bilingüe,
// es descuidado.
//
// Se resuelve como el tema: un diccionario por idioma y un objeto de getters
// que lee el que esté activo, así los lugares que usan un texto no saben que
// existe un idioma. `/language` lo cambia en caliente.
//
// El idioma también viaja al agente —está en el prompt de sistema— porque de
// nada sirve una interfaz en inglés si el modelo contesta en castellano.
//
// Los que llevan datos adentro son funciones y no plantillas con marcadores:
// una función la revisa el compilador, una plantilla con `{0}` no.
import { createSignal } from "solid-js"

export const LANGS = ["en", "es"] as const
export type Lang = (typeof LANGS)[number]

export interface Textos {
  // ── Bienvenida ───────────────────────────────────────────────────────────
  lema: string
  comoEmpieza: string
  cadena: [string, string, string]
  panelSolo: string
  probaCon: string
  ejemplos: readonly [string, string, string]
  ptConectado: string
  ptSinConexion: string
  faltaMcp: string
  comoInstalarMcp: string
  abriMcpBuilder: string
  atajos: string

  // ── Panel de topología ───────────────────────────────────────────────────
  sinDatos: string
  esperandoDespliegue: string
  familias: Record<"router" | "switch" | "wireless" | "cloud" | "host" | "other", string>
  sinEnlaces: string
  pediExport: string
  sinIp: string
  fabric: string
  devices: string
  topology: string
  nodos: (n: number) => string
  enlaces: (n: number) => string

  // ── Actividad y barra de estado ──────────────────────────────────────────
  fases: Record<"idle" | "requesting" | "thinking" | "writing" | "tool", string>
  turnos: (n: number) => string
  nodosBarra: (n: number) => string

  // ── Conversación ─────────────────────────────────────────────────────────
  vos: string
  agente: string
  planoCanvas: string
  enPacketTracer: string
  enElModelo: string

  // ── Campo de escritura ───────────────────────────────────────────────────
  trabajando: string
  describiLaRed: string

  // ── Paleta ───────────────────────────────────────────────────────────────
  nadaCoincide: string
  ayudaTeclas: string
  tituloComandos: string
  tituloTema: string
  tituloModelo: string
  tituloEsfuerzo: string
  tituloMotor: string
  tituloIdioma: string
  tituloProveedor: string
  tituloPlan: string
  nPlanes: (n: number) => string
  grupoConectados: string
  grupoCli: string
  grupoDestacados: string
  grupoTodos: string
  conectado: string
  pegaLaKey: (consola: string) => string
  keyGuardada: (label: string, id: string) => string
  noSePudoGuardar: string
  loginDispositivo: (url: string, codigo: string) => string
  loginListo: (label: string) => string
  loginFallo: (motivo: string) => string
  sinMedidor: string
  tituloUso: string

  // ── Comandos ─────────────────────────────────────────────────────────────
  cat: Record<"agente" | "apariencia" | "pt" | "utilidad", string>
  cmd: Record<string, { title: string; desc: string }>
  modelos: Record<string, string>
  esfuerzos: Record<string, string>
  idiomas: Record<Lang, string>

  // ── Respuestas de los comandos ───────────────────────────────────────────
  sesionMuerta: string
  ahoraModelo: (model: string, effort: string, sigue: boolean) => string
  motorSoloAlArrancar: (nombre: string) => string
  efectosOn: string
  efectosOff: string
  sinRespuestaQueCopiar: string
  copiado: string
  noSePuedeCopiar: string
  guardadoEn: (ruta: string) => string
  mcpFalta: string
  mcpListoPuenteArriba: string
  mcpListoPuenteAbajo: string
  ayudaPie: string
  promptTopology: string
  promptBridge: string
}

const es: Textos = {
  lema: "redes en Packet Tracer, dichas en castellano",
  comoEmpieza: "cómo empieza",
  cadena: ["vos ", " agente ", " packet tracer"],
  panelSolo: "el panel de la derecha se dibuja solo",
  probaCon: "PROBÁ CON",
  ejemplos: [
    "leé la topología y decime qué está mal",
    "3 routers con OSPF y una LAN en cada uno",
    "segmentá en VLANs por departamento",
  ],
  ptConectado: "packet tracer conectado",
  ptSinConexion: "packet tracer sin conexión",
  faltaMcp: "falta el MCP de packet tracer",
  comoInstalarMcp: "claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio",
  abriMcpBuilder: "abrí Extensiones ▸ MCP BUILDER en Packet Tracer",
  atajos: "⏎ enviar · ⇧⏎ línea",

  sinDatos: "SIN DATOS",
  esperandoDespliegue: "esperando despliegue",
  familias: {
    router: "ROUTERS", switch: "SWITCHES", wireless: "INALÁMBRICO",
    cloud: "NUBE/WAN", host: "EQUIPOS", other: "OTROS",
  },
  sinEnlaces: "⚠ sin enlaces — lista plana",
  pediExport: "  pedí pt_export_topology",
  sinIp: "sin IP",
  fabric: "estructura",
  devices: "equipos",
  topology: "topología",
  nodos: (n) => `${n} ${n === 1 ? "EQUIPO" : "EQUIPOS"}`,
  enlaces: (n) => `${n} ${n === 1 ? "ENLACE" : "ENLACES"}`,

  fases: {
    idle: "LISTO", requesting: "CONSULTANDO", thinking: "RAZONANDO",
    writing: "ESCRIBIENDO", tool: "EJECUTANDO",
  },
  turnos: (n) => `${n} ${n === 1 ? "TURNO" : "TURNOS"}`,
  nodosBarra: (n) => `${n} ${n === 1 ? "NODO" : "NODOS"}`,

  vos: "VOS",
  agente: "AGENTE",
  planoCanvas: " PLANO · CANVAS DE PT ",
  enPacketTracer: "en packet tracer",
  enElModelo: "en el modelo",

  trabajando: "el agente está trabajando…",
  describiLaRed: "describí la red que querés  ·  / para comandos",

  nadaCoincide: "  nada coincide",
  ayudaTeclas: "⇅ mover · ←→ familia · ⏎ elegir · esc ",
  tituloComandos: "comandos",
  tituloTema: "tema",
  tituloModelo: "modelo",
  tituloEsfuerzo: "esfuerzo",
  tituloMotor: "motor",
  tituloIdioma: "idioma",
  tituloProveedor: "proveedor",
  tituloPlan: "plan",
  nPlanes: (n) => `${n} planes`,
  grupoConectados: "conectados",
  grupoCli: "por CLI",
  grupoDestacados: "destacados",
  grupoTodos: "todos",
  conectado: "conectado",
  pegaLaKey: (c) => `pegá la API key y dale ⏎. Se sacan en ${c}`,
  keyGuardada: (l, id) => `Key de **${l}** guardada. Usala con \`/engine\` → \`${id}\`.`,
  noSePudoGuardar: "No se pudo escribir la key. Revisá los permisos de `~/.packetsmith`.",
  loginDispositivo: (url, cod) =>
    `Abrí **${url}** y poné el código **${cod}**.

Acá se espera solo; cuando autorices sigue.`,
  loginListo: (l) => `Sesión de **${l}** guardada. Ya podés mandar un mensaje.`,
  loginFallo: (m) => `No se pudo completar el login: ${m}`,
  sinMedidor: "Este plan no publica un medidor de consumo.",
  tituloUso: "consumo",

  cat: { agente: "agente", apariencia: "apariencia", pt: "packet tracer", utilidad: "utilidad" },
  cmd: {
    "model.list": { title: "/model", desc: "cambiar de modelo sin perder la conversación" },
    "effort.list": { title: "/effort", desc: "cuánto razona antes de contestar" },
    "engine.list": { title: "/engine", desc: "quién contesta: ~150 proveedores" },
    "session.clear": { title: "/clear", desc: "empezar de cero: borra la conversación y el panel" },
    "theme.list": { title: "/theme", desc: "cambiar la paleta, con vista previa" },
    "theme.effects": { title: "/effects", desc: "scanlines y viñeta de monitor CRT" },
    "app.language": { title: "/language", desc: "idioma de la interfaz y de las respuestas" },
    "app.connect": { title: "/connect", desc: "elegir proveedor y plan, y conectarlo" },
    "pt.topology": { title: "/topology", desc: "releer la topología y repoblar el panel" },
    "pt.bridge": { title: "/bridge", desc: "comprobar el puente con Packet Tracer" },
    "app.help": { title: "/help", desc: "qué comandos hay" },
    "app.mcp": { title: "/mcp", desc: "si el MCP de Packet Tracer está registrado" },
    "app.debug": { title: "/debug", desc: "sesión, binario, modelo y esfuerzo en curso" },
    "app.usage": { title: "/usage", desc: "cuánto va consumido del plan" },
    "app.copy": { title: "/copy", desc: "copiar la última respuesta al portapapeles" },
    "app.export": { title: "/export", desc: "guardar la conversación y la topología" },
    "app.exit": { title: "/exit", desc: "salir" },
  },
  modelos: {
    opus: "el más capaz — para diseñar la red",
    sonnet: "equilibrado — el de todos los días",
    haiku: "el más rápido y barato — para consultar",
    fable: "el más nuevo de la familia",
  },
  esfuerzos: {
    low: "responde ya, piensa poco",
    medium: "el punto medio",
    high: "piensa antes de tocar la red",
    xhigh: "para topologías con enrutamiento complicado",
    max: "todo el razonamiento disponible",
  },
  idiomas: { en: "English", es: "castellano" },

  sesionMuerta: "⚠ la sesión con el agente terminó. Probá `/clear` para levantar una nueva.",
  ahoraModelo: (m, e, sigue) =>
    `Modelo **${m}**, esfuerzo **${e}**.${sigue ? " La conversación sigue." : ""}`,
  motorSoloAlArrancar: (n) => `El motor se elige al arrancar: \`packetsmith --engine ${n}\`.`,
  efectosOn: "Efectos CRT encendidos.",
  efectosOff: "Efectos CRT apagados.",
  sinRespuestaQueCopiar: "Todavía no hay ninguna respuesta que copiar.",
  copiado: "Última respuesta copiada.",
  noSePuedeCopiar: "Este terminal no acepta copiar desde la aplicación.",
  guardadoEn: (r) => `Guardado en \`${r}\`.`,
  mcpFalta:
    "El MCP de Packet Tracer **no** está registrado en el CLI, así que el agente no tiene " +
    "una sola tool `pt_*`.\n\n```\nclaude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio\n```",
  mcpListoPuenteArriba: "MCP registrado y puente con Packet Tracer levantado.",
  mcpListoPuenteAbajo:
    "MCP registrado, pero el puente no responde. Abrí Extensiones ▸ MCP BUILDER en Packet Tracer.",
  ayudaPie: "Se abren con `/` en un mensaje vacío, o con Ctrl+P.",
  promptTopology:
    "Corré pt_export_topology y no hagas nada más. Resumime en UNA línea qué hay en el canvas.",
  promptBridge:
    "Corré pt_bridge_status y decime en UNA línea si está conectado y por qué canal.",
}

const en: Textos = {
  lema: "networks in Packet Tracer, described in plain language",
  comoEmpieza: "how it starts",
  cadena: ["you ", " agent ", " packet tracer"],
  panelSolo: "the panel on the right draws itself",
  probaCon: "TRY ASKING",
  ejemplos: [
    "read the topology and tell me what's wrong",
    "3 routers with OSPF and a LAN on each",
    "segment it into VLANs by department",
  ],
  ptConectado: "packet tracer connected",
  ptSinConexion: "packet tracer not connected",
  faltaMcp: "the packet tracer MCP is missing",
  comoInstalarMcp: "claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio",
  abriMcpBuilder: "open Extensions ▸ MCP BUILDER in Packet Tracer",
  atajos: "⏎ send · ⇧⏎ newline",

  sinDatos: "NO DATA",
  esperandoDespliegue: "awaiting deployment",
  familias: {
    router: "ROUTERS", switch: "SWITCHES", wireless: "WIRELESS",
    cloud: "CLOUD/WAN", host: "HOSTS", other: "OTHER",
  },
  sinEnlaces: "⚠ no links — flat list",
  pediExport: "  ask for pt_export_topology",
  sinIp: "no IP",
  fabric: "fabric",
  devices: "devices",
  topology: "topology",
  nodos: (n) => `${n} ${n === 1 ? "NODE" : "NODES"}`,
  enlaces: (n) => `${n} ${n === 1 ? "LINK" : "LINKS"}`,

  fases: {
    idle: "READY", requesting: "REQUESTING", thinking: "REASONING",
    writing: "WRITING", tool: "RUNNING",
  },
  turnos: (n) => `${n} ${n === 1 ? "TURN" : "TURNS"}`,
  nodosBarra: (n) => `${n} ${n === 1 ? "NODE" : "NODES"}`,

  vos: "YOU",
  agente: "AGENT",
  planoCanvas: " PLAN · PT CANVAS ",
  enPacketTracer: "in packet tracer",
  enElModelo: "in the model",

  trabajando: "the agent is working…",
  describiLaRed: "describe the network you want  ·  / for commands",

  nadaCoincide: "  no matches",
  ayudaTeclas: "⇅ move · ←→ group · ⏎ pick · esc ",
  tituloComandos: "commands",
  tituloTema: "theme",
  tituloModelo: "model",
  tituloEsfuerzo: "effort",
  tituloMotor: "engine",
  tituloIdioma: "language",
  tituloProveedor: "provider",
  tituloPlan: "plan",
  nPlanes: (n) => `${n} plans`,
  grupoConectados: "connected",
  grupoCli: "via CLI",
  grupoDestacados: "featured",
  grupoTodos: "all",
  conectado: "connected",
  pegaLaKey: (c) => `paste the API key and hit ⏎. Get one at ${c}`,
  keyGuardada: (l, id) => `**${l}** key saved. Use it with \`/engine\` → \`${id}\`.`,
  noSePudoGuardar: "Could not write the key. Check the permissions on `~/.packetsmith`.",
  loginDispositivo: (url, cod) =>
    `Open **${url}** and enter the code **${cod}**.\n\nJust wait here; it continues once you authorize.`,
  loginListo: (l) => `**${l}** session saved. You can send a message now.`,
  loginFallo: (m) => `Could not finish the login: ${m}`,
  sinMedidor: "This plan does not publish a usage meter.",
  tituloUso: "usage",

  cat: { agente: "agent", apariencia: "appearance", pt: "packet tracer", utilidad: "utility" },
  cmd: {
    "model.list": { title: "/model", desc: "switch model without losing the conversation" },
    "effort.list": { title: "/effort", desc: "how hard it thinks before answering" },
    "engine.list": { title: "/engine", desc: "who answers: ~150 providers" },
    "session.clear": { title: "/clear", desc: "start over: clears the conversation and the panel" },
    "theme.list": { title: "/theme", desc: "switch palette, with live preview" },
    "theme.effects": { title: "/effects", desc: "CRT scanlines and vignette" },
    "app.language": { title: "/language", desc: "interface and reply language" },
    "app.connect": { title: "/connect", desc: "pick a provider and plan, and connect it" },
    "pt.topology": { title: "/topology", desc: "re-read the topology and refill the panel" },
    "pt.bridge": { title: "/bridge", desc: "check the bridge to Packet Tracer" },
    "app.help": { title: "/help", desc: "what commands there are" },
    "app.mcp": { title: "/mcp", desc: "whether the Packet Tracer MCP is registered" },
    "app.debug": { title: "/debug", desc: "session, binary, model and effort in use" },
    "app.usage": { title: "/usage", desc: "how much of the plan is used up" },
    "app.copy": { title: "/copy", desc: "copy the last reply to the clipboard" },
    "app.export": { title: "/export", desc: "save the conversation and the topology" },
    "app.exit": { title: "/exit", desc: "quit" },
  },
  modelos: {
    opus: "the most capable — for designing the network",
    sonnet: "balanced — the everyday one",
    haiku: "fastest and cheapest — for asking questions",
    fable: "the newest of the family",
  },
  esfuerzos: {
    low: "answers now, thinks little",
    medium: "the middle ground",
    high: "thinks before touching the network",
    xhigh: "for topologies with tricky routing",
    max: "all the reasoning available",
  },
  idiomas: { en: "English", es: "Spanish" },

  sesionMuerta: "⚠ the agent session ended. Try `/clear` to start a new one.",
  ahoraModelo: (m, e, sigue) =>
    `Model **${m}**, effort **${e}**.${sigue ? " The conversation carries over." : ""}`,
  motorSoloAlArrancar: (n) => `The engine is chosen at startup: \`packetsmith --engine ${n}\`.`,
  efectosOn: "CRT effects on.",
  efectosOff: "CRT effects off.",
  sinRespuestaQueCopiar: "There is no reply to copy yet.",
  copiado: "Last reply copied.",
  noSePuedeCopiar: "This terminal does not accept copying from the application.",
  guardadoEn: (r) => `Saved to \`${r}\`.`,
  mcpFalta:
    "The Packet Tracer MCP is **not** registered with the CLI, so the agent has no `pt_*` " +
    "tool at all.\n\n```\nclaude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio\n```",
  mcpListoPuenteArriba: "MCP registered and the bridge to Packet Tracer is up.",
  mcpListoPuenteAbajo:
    "MCP registered, but the bridge is not answering. Open Extensions ▸ MCP BUILDER in Packet Tracer.",
  ayudaPie: "Open them with `/` on an empty message, or with Ctrl+P.",
  promptTopology:
    "Run pt_export_topology and nothing else. Sum up in ONE line what is on the canvas.",
  promptBridge:
    "Run pt_bridge_status and tell me in ONE line whether it is connected and over which channel.",
}

const DICT: Record<Lang, Textos> = { en, es }

/**
 * Idioma de arranque, deducido del entorno.
 *
 * Se mira el locale porque es el dato que ya existe y no hay que preguntar. Sin
 * locale —lo normal en Windows— arranca en inglés, que es el idioma de la
 * documentación del proyecto. `/language`, `--language` y la config lo pisan.
 */
export function detectar(env: NodeJS.ProcessEnv = process.env): Lang {
  const locale = env.PACKETSMITH_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || ""
  return locale.toLowerCase().startsWith("es") ? "es" : "en"
}

const [actual, setActual] = createSignal<Lang>(detectar())

export const idioma = actual

/** Cambia el idioma. Devuelve false si no existe, sin tocar nada. */
export function setIdioma(l: string): boolean {
  if (!(LANGS as readonly string[]).includes(l)) return false
  setActual(l as Lang)
  return true
}

/**
 * Los textos del idioma activo.
 *
 * Cada clave es un getter, así que leer `T.lema` adentro de un JSX queda
 * suscripto al idioma sin que el que lo usa tenga que saberlo — el mismo truco
 * que la paleta de colores.
 */
export const T: Textos = Object.defineProperties(
  {} as Textos,
  Object.fromEntries(
    (Object.keys(en) as (keyof Textos)[]).map((k) => [
      k,
      { get: () => DICT[actual()][k], enumerable: true },
    ]),
  ),
)
