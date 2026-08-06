// Todo lo que se puede elegir, como comando.
//
// Un comando es DATO: nombre, qué hace, y una función que recibe un contexto.
// No importa nada de la interfaz, así que se testea sin montar nada — igual que
// `translate` en el motor o `ingest` en la topología.
//
// Los que necesitan que elijas algo no tienen un concepto de "argumentos": su
// `run` abre otro diálogo y listo. Eso evita inventar un tipo `Comando con
// parámetros` que después habría que parsear, validar y completar.
import { EFFORTS, type Effort } from "../engine/types.ts"
import { THEMES } from "./themes.ts"
import { dialog, type Opcion } from "./picker.tsx"

/** Lo que un comando puede tocar de la app. Lo arma `app.tsx`. */
export interface CommandCtx {
  /** Contesta en el chat SIN gastar un turno del agente. */
  decir(texto: string): void
  /**
   * Le manda un mensaje al agente. `etiqueta` es lo que se muestra en el chat:
   * el prompt de verdad es largo y específico, y verlo entero sería ruido.
   */
  pedir(texto: string, etiqueta: string): void
  /**
   * Relanza la sesión conservando la conversación.
   *
   * El modelo y el esfuerzo son argumentos de arranque del CLI, así que no se
   * pueden cambiar en caliente. Pero `--resume` deja levantar otro proceso
   * sobre la MISMA sesión, así que cambiar de modelo no cuesta el contexto.
   */
  reiniciar(cambios: { model?: string; effort?: Effort }): void
  /** Sesión nueva de cero: limpia la conversación y el panel. */
  limpiar(): void
  salir(): void
  /** Copia al portapapeles. Devuelve false si el terminal no lo soporta. */
  copiar(texto: string): boolean
  /** Escribe la transcripción y la topología a un archivo. Devuelve la ruta. */
  exportar(): string
  tema: {
    actual(): string
    /** Aplica sin guardar. Para previsualizar mientras se recorre la lista. */
    poner(nombre: string): void
    /** Aplica Y guarda. Solo al elegir de verdad. */
    confirmar(nombre: string): void
  }
  efectos: { activos(): boolean; alternar(): boolean }
  estado(): Estado
}

export interface Estado {
  engine: string
  model: string
  effort: Effort
  sessionId: string
  /** Lo que el motor quiera contar de sí mismo. Puede venir vacío. */
  motor: Record<string, string>
  mcp: boolean
  bridge: boolean
  nodos: number
  enlaces: number
  turnos: number
  costoUsd: number
  ultimaRespuesta: string
  motores: string[]
}

export interface Command {
  /** Id estable. Se usa para referirse al comando sin depender del texto. */
  name: string
  /** Lo que se ve y se tipea. */
  title: string
  description: string
  category: string
  run(ctx: CommandCtx): void
}

/**
 * Los modelos que se ofrecen.
 *
 * Son los alias del CLI y no nombres completos a propósito: un alias apunta
 * siempre a la última versión de esa familia, así que la lista no envejece cada
 * vez que sale un modelo nuevo. `claude --help` los documenta.
 */
const MODELOS: { value: string; description: string }[] = [
  { value: "opus", description: "el más capaz — para diseñar la red" },
  { value: "sonnet", description: "equilibrado — el de todos los días" },
  { value: "haiku", description: "el más rápido y barato — para consultar" },
  { value: "fable", description: "el más nuevo de la familia" },
]

const ESFUERZOS: Record<Effort, string> = {
  low: "responde ya, piensa poco",
  medium: "el punto medio",
  high: "piensa antes de tocar la red",
  xhigh: "para topologías con enrutamiento complicado",
  max: "todo el razonamiento disponible",
}

/** Identidad tipada: deja que TypeScript revise cada opción al construirla. */
const opcion = (o: Opcion): Opcion => o

export const COMMANDS: Command[] = [
  // ── Agente ──────────────────────────────────────────────────────────────
  {
    name: "model.list",
    title: "/model",
    description: "cambiar de modelo sin perder la conversación",
    category: "agente",
    run(ctx) {
      const actual = ctx.estado().model
      dialog.abrir({
        titulo: "modelo",
        opciones: MODELOS.map((m) => opcion({
          value: m.value,
          title: m.value,
          description: m.description,
          // El modelo que informa el CLI es el nombre completo
          // (`claude-sonnet-5`), así que se compara por inclusión del alias.
          current: actual.includes(m.value),
        })),
        onElegir: (o) => ctx.reiniciar({ model: o.value }),
      })
    },
  },
  {
    name: "effort.list",
    title: "/effort",
    description: "cuánto razona antes de contestar",
    category: "agente",
    run(ctx) {
      const actual = ctx.estado().effort
      dialog.abrir({
        titulo: "esfuerzo",
        opciones: EFFORTS.map((e) => opcion({
          value: e, title: e, description: ESFUERZOS[e], current: e === actual,
        })),
        onElegir: (o) => ctx.reiniciar({ effort: o.value as Effort }),
      })
    },
  },
  {
    name: "engine.list",
    title: "/engine",
    description: "qué CLI de agente corre por debajo",
    category: "agente",
    run(ctx) {
      const { engine, motores } = ctx.estado()
      dialog.abrir({
        titulo: "motor",
        opciones: motores.map((m) => opcion({ value: m, title: m, current: m === engine })),
        onElegir: (o) => {
          if (o.value === engine) return
          ctx.decir(`El motor se elige al arrancar: \`packetsmith --engine ${o.value}\`.`)
        },
      })
    },
  },
  {
    name: "session.clear",
    title: "/clear",
    description: "empezar de cero: borra la conversación y el panel",
    category: "agente",
    run: (ctx) => ctx.limpiar(),
  },

  // ── Apariencia ──────────────────────────────────────────────────────────
  {
    name: "theme.list",
    title: "/theme",
    description: "cambiar la paleta, con vista previa",
    category: "apariencia",
    run(ctx) {
      const inicial = ctx.tema.actual()
      dialog.abrir({
        titulo: "tema",
        opciones: THEMES.map((t) => opcion({
          value: t.name, title: t.name, description: t.label, current: t.name === inicial,
        })),
        // Previsualiza mientras te movés: elegir un tema mirando su nombre es
        // adivinar. Si salís con Esc vuelve al que tenías.
        onMover: (o) => ctx.tema.poner(o.value),
        onCancelar: () => ctx.tema.poner(inicial),
        onElegir: (o) => ctx.tema.confirmar(o.value),
      })
    },
  },
  {
    name: "theme.effects",
    title: "/effects",
    description: "scanlines y viñeta de monitor CRT",
    category: "apariencia",
    run: (ctx) => ctx.decir(ctx.efectos.alternar() ? "Efectos CRT encendidos." : "Efectos CRT apagados."),
  },

  // ── Packet Tracer ───────────────────────────────────────────────────────
  //
  // Le piden algo al agente en vez de hablar con el MCP: la TUI no puede abrir
  // su propio cliente porque se pelearía por el puerto 54321 con el que ya tiene
  // el CLI. Cuestan un turno, y por eso son solo estos dos: los que resuelven
  // un problema que no se resuelve pidiéndolo en castellano.
  {
    name: "pt.topology",
    title: "/topology",
    description: "releer la topología y repoblar el panel",
    category: "packet tracer",
    run: (ctx) => ctx.pedir(
      "Corré pt_export_topology y no hagas nada más. " +
      "Resumime en UNA línea qué hay en el canvas.", "/topology"),
  },
  {
    name: "pt.bridge",
    title: "/bridge",
    description: "comprobar el puente con Packet Tracer",
    category: "packet tracer",
    run: (ctx) => ctx.pedir(
      "Corré pt_bridge_status y decime en UNA línea si está conectado y por qué canal.", "/bridge"),
  },

  // ── Utilidad ────────────────────────────────────────────────────────────
  {
    name: "app.help",
    title: "/help",
    description: "qué comandos hay",
    category: "utilidad",
    run(ctx) {
      const porCategoria = new Map<string, Command[]>()
      for (const c of COMMANDS) {
        const lista = porCategoria.get(c.category) ?? []
        lista.push(c)
        porCategoria.set(c.category, lista)
      }
      const cuerpo = [...porCategoria]
        .map(([cat, cs]) =>
          `## ${cat}\n` + cs.map((c) => `- ${c.title} — ${c.description}`).join("\n"))
        .join("\n\n")
      ctx.decir(`${cuerpo}\n\nSe abren con \`/\` en un mensaje vacío, o con Ctrl+P.`)
    },
  },
  {
    name: "app.mcp",
    title: "/mcp",
    description: "si el MCP de Packet Tracer está registrado",
    category: "utilidad",
    run(ctx) {
      const { mcp, bridge } = ctx.estado()
      if (!mcp) {
        ctx.decir(
          "El MCP de Packet Tracer **no** está registrado en el CLI, así que el agente " +
          "no tiene una sola tool `pt_*`.\n\n```\nclaude mcp add packet-tracer -- " +
          "<python> -m packet_tracer_mcp --stdio\n```")
        return
      }
      ctx.decir(bridge
        ? "MCP registrado y puente con Packet Tracer levantado."
        : "MCP registrado, pero el puente no responde. Abrí Extensiones ▸ MCP BUILDER en Packet Tracer.")
    },
  },
  {
    name: "app.debug",
    title: "/debug",
    description: "sesión, binario, modelo y esfuerzo en curso",
    category: "utilidad",
    run(ctx) {
      const e = ctx.estado()
      ctx.decir([
        "| dato | valor |", "|---|---|",
        `| motor | ${e.engine} |`,
        ...Object.entries(e.motor).map(([k, v]) => `| ${k} | ${v} |`),
        `| modelo | ${e.model} |`,
        `| esfuerzo | ${e.effort} |`,
        `| sesión | ${e.sessionId || "—"} |`,
        `| tema | ${ctx.tema.actual()} |`,
        `| MCP | ${e.mcp ? "registrado" : "falta"} |`,
        `| puente | ${e.bridge ? "arriba" : "abajo"} |`,
        `| red | ${e.nodos} nodos · ${e.enlaces} enlaces |`,
        `| turnos | ${e.turnos} |`,
        `| costo | $${e.costoUsd.toFixed(4)} |`,
      ].join("\n"))
    },
  },
  {
    name: "app.copy",
    title: "/copy",
    description: "copiar la última respuesta al portapapeles",
    category: "utilidad",
    run(ctx) {
      const texto = ctx.estado().ultimaRespuesta
      if (!texto) { ctx.decir("Todavía no hay ninguna respuesta que copiar."); return }
      ctx.decir(ctx.copiar(texto)
        ? "Última respuesta copiada."
        : "Este terminal no acepta copiar desde la aplicación.")
    },
  },
  {
    name: "app.export",
    title: "/export",
    description: "guardar la conversación y la topología",
    category: "utilidad",
    run: (ctx) => ctx.decir(`Guardado en \`${ctx.exportar()}\`.`),
  },
  {
    name: "app.exit",
    title: "/exit",
    description: "salir",
    category: "utilidad",
    run: (ctx) => ctx.salir(),
  },
]

/** Las opciones de la paleta, en el orden en que se declararon los comandos. */
export function opcionesDeComandos(): Opcion[] {
  return COMMANDS.map((c) => ({
    value: c.name,
    title: c.title,
    description: c.description,
    category: c.category,
  }))
}

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name)
}
