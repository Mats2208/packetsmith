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
import { LANGS, T, type Lang } from "./i18n.ts"
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
  idioma: {
    actual(): Lang
    /** Aplica Y guarda: el idioma no se previsualiza. */
    poner(l: Lang): void
  }
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
  /** Id estable. Es la clave del diccionario, así que no depende del idioma. */
  name: string
  /** Qué familia. La etiqueta traducida sale de `T.cat`. */
  category: keyof typeof T.cat
  run(ctx: CommandCtx): void
}

/** Lo que se ve del comando, en el idioma activo. */
export const textoDe = (c: Command) => T.cmd[c.name] ?? { title: c.name, desc: "" }

/**
 * Los modelos que se ofrecen.
 *
 * Son los alias del CLI y no nombres completos a propósito: un alias apunta
 * siempre a la última versión de esa familia, así que la lista no envejece cada
 * vez que sale un modelo nuevo. `claude --help` los documenta.
 */
const MODELOS = ["opus", "sonnet", "haiku", "fable"] as const

/** Identidad tipada: deja que TypeScript revise cada opción al construirla. */
const opcion = (o: Opcion): Opcion => o

export const COMMANDS: Command[] = [
  // ── Agente ──────────────────────────────────────────────────────────────
  {
    name: "model.list",
    category: "agente",
    run(ctx) {
      const actual = ctx.estado().model
      dialog.abrir({
        titulo: T.tituloModelo,
        opciones: MODELOS.map((m) => opcion({
          value: m,
          title: m,
          description: T.modelos[m],
          // El modelo que informa el CLI es el nombre completo
          // (`claude-sonnet-5`), así que se compara por inclusión del alias.
          current: actual.includes(m),
        })),
        onElegir: (o) => ctx.reiniciar({ model: o.value }),
      })
    },
  },
  {
    name: "effort.list",
    category: "agente",
    run(ctx) {
      const actual = ctx.estado().effort
      dialog.abrir({
        titulo: T.tituloEsfuerzo,
        opciones: EFFORTS.map((e) => opcion({
          value: e, title: e, description: T.esfuerzos[e], current: e === actual,
        })),
        onElegir: (o) => ctx.reiniciar({ effort: o.value as Effort }),
      })
    },
  },
  {
    name: "engine.list",
    category: "agente",
    run(ctx) {
      const { engine, motores } = ctx.estado()
      dialog.abrir({
        titulo: T.tituloMotor,
        opciones: motores.map((m) => opcion({ value: m, title: m, current: m === engine })),
        onElegir: (o) => {
          if (o.value === engine) return
          ctx.decir(T.motorSoloAlArrancar(o.value))
        },
      })
    },
  },
  {
    name: "session.clear",
    category: "agente",
    run: (ctx) => ctx.limpiar(),
  },

  // ── Apariencia ──────────────────────────────────────────────────────────
  {
    name: "theme.list",
    category: "apariencia",
    run(ctx) {
      const inicial = ctx.tema.actual()
      dialog.abrir({
        titulo: T.tituloTema,
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
    category: "apariencia",
    run: (ctx) => ctx.decir(ctx.efectos.alternar() ? T.efectosOn : T.efectosOff),
  },
  {
    // El idioma NO se previsualiza como el tema: cambiarlo mientras recorrés la
    // lista te dejaría leyendo la propia lista en un idioma distinto en cada
    // renglón, que es mareador y no ayuda a elegir.
    name: "app.language",
    category: "apariencia",
    run(ctx) {
      const actual = ctx.idioma.actual()
      dialog.abrir({
        titulo: T.tituloIdioma,
        opciones: LANGS.map((l) => opcion({
          value: l, title: l, description: T.idiomas[l], current: l === actual,
        })),
        onElegir: (o) => ctx.idioma.poner(o.value as Lang),
      })
    },
  },

  // ── Packet Tracer ───────────────────────────────────────────────────────
  //
  // Le piden algo al agente en vez de hablar con el MCP: la TUI no puede abrir
  // su propio cliente porque se pelearía por el puerto 54321 con el que ya tiene
  // el CLI. Cuestan un turno, y por eso son solo estos dos: los que resuelven
  // un problema que no se resuelve pidiéndolo en palabras.
  {
    name: "pt.topology",
    category: "pt",
    run: (ctx) => ctx.pedir(T.promptTopology, textoDe(COMMANDS[0]!).title && "/topology"),
  },
  {
    name: "pt.bridge",
    category: "pt",
    run: (ctx) => ctx.pedir(T.promptBridge, "/bridge"),
  },

  // ── Utilidad ────────────────────────────────────────────────────────────
  {
    name: "app.help",
    category: "utilidad",
    run(ctx) {
      const porFamilia = new Map<string, Command[]>()
      for (const c of COMMANDS) {
        const lista = porFamilia.get(c.category) ?? []
        lista.push(c)
        porFamilia.set(c.category, lista)
      }
      const cuerpo = [...porFamilia]
        .map(([cat, cs]) => [
          `## ${T.cat[cat as keyof typeof T.cat]}`,
          ...cs.map((c) => `- ${textoDe(c).title} — ${textoDe(c).desc}`),
        ].join("\n"))
        .join("\n\n")
      ctx.decir([cuerpo, "", T.ayudaPie].join("\n"))
    },
  },
  {
    name: "app.mcp",
    category: "utilidad",
    run(ctx) {
      const { mcp, bridge } = ctx.estado()
      if (!mcp) { ctx.decir(T.mcpFalta); return }
      ctx.decir(bridge ? T.mcpListoPuenteArriba : T.mcpListoPuenteAbajo)
    },
  },
  {
    name: "app.debug",
    category: "utilidad",
    run(ctx) {
      const e = ctx.estado()
      ctx.decir([
        "| | |", "|---|---|",
        `| engine | ${e.engine} |`,
        ...Object.entries(e.motor).map(([k, v]) => `| ${k} | ${v} |`),
        `| model | ${e.model} |`,
        `| effort | ${e.effort} |`,
        `| session | ${e.sessionId || "—"} |`,
        `| theme | ${ctx.tema.actual()} |`,
        `| language | ${ctx.idioma.actual()} |`,
        `| MCP | ${e.mcp ? "registered" : "missing"} |`,
        `| bridge | ${e.bridge ? "up" : "down"} |`,
        `| network | ${e.nodos} · ${e.enlaces} |`,
        `| turns | ${e.turnos} |`,
        `| cost | $${e.costoUsd.toFixed(4)} |`,
      ].join("\n"))
    },
  },
  {
    name: "app.copy",
    category: "utilidad",
    run(ctx) {
      const texto = ctx.estado().ultimaRespuesta
      if (!texto) { ctx.decir(T.sinRespuestaQueCopiar); return }
      ctx.decir(ctx.copiar(texto) ? T.copiado : T.noSePuedeCopiar)
    },
  },
  {
    name: "app.export",
    category: "utilidad",
    run: (ctx) => ctx.decir(T.guardadoEn(ctx.exportar())),
  },
  {
    name: "app.exit",
    category: "utilidad",
    run: (ctx) => ctx.salir(),
  },
]

/** Las opciones de la paleta, en el idioma activo. */
export function opcionesDeComandos(): Opcion[] {
  return COMMANDS.map((c) => ({
    value: c.name,
    title: textoDe(c).title,
    description: textoDe(c).desc,
    category: T.cat[c.category],
  }))
}

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name)
}

/** El comando cuyo `/nombre` coincide con lo tipeado, en el idioma activo. */
export function comandoPorTitulo(texto: string): Command | undefined {
  const primero = texto.trim().split(/\s+/)[0]
  return COMMANDS.find((c) => textoDe(c).title === primero)
}
