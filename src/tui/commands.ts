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
import type { Medida } from "../engine/providers/usage.ts"
import { THEMES } from "./themes.ts"
import { LANGS, T, type Lang } from "./i18n.ts"
import { findProvider, PROVIDERS, todosLosProveedores, type Plan } from "../engine/providers/catalog.ts"
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
  /** Cambia de motor. Empieza limpio: modelo y sesión son del motor viejo. */
  cambiarMotor(nombre: string): void
  /** Guarda la API key de un plan. Devuelve si se pudo escribir. */
  guardarKey(provider: string, plan: string, key: string): boolean
  /**
   * Hace el login de dispositivo y guarda la sesión.
   *
   * `mostrar` recibe la URL y el código apenas los hay: el sondeo puede tardar
   * un minuto entero, y una pantalla muda todo ese rato parece colgada.
   */
  conectarChatGPT(provider: string, plan: string, mostrar: (url: string, codigo: string) => void): void
  /** Si ya hay credencial para ese proveedor. Nunca devuelve la credencial. */
  hayKey(provider: string): boolean
  /** Qué plan tiene elegido, para marcarlo en la lista. */
  planDe(provider: string): string | undefined
  /** Cuánto va consumido del plan en uso. `undefined` si no publica medidor. */
  medidor(): Promise<Medida | undefined>
  /** Los modelos del motor EN USO. Los de Claude no existen en Kimi. */
  modelosDelMotor(): { value: string; description?: string }[]
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
        // Los modelos los declara el MOTOR: los alias de Claude no existen en
        // Kimi, y ofrecerlos con Kimi puesto es ofrecer algo que va a fallar.
        opciones: ctx.modelosDelMotor().map((m) => opcion({
          value: m.value,
          title: m.value,
          description: m.description ?? T.modelos[m.value],
          // El nombre que informa el CLI de Claude es el completo
          // (`claude-sonnet-5`), así que se compara por inclusión del alias.
          current: actual === m.value || actual.includes(m.value),
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
      // Con ciento cincuenta motores, el orden ES la interfaz: primero los que
      // ya tenés conectados —que son los que vas a querer— después los curados,
      // y al final el resto de models.dev. Filtrar tipeando sigue estando.
      const familia = (m: string) => {
        if (m === "claude") return T.grupoCli
        if (ctx.hayKey(m)) return T.grupoConectados
        return findProvider(m) && PROVIDERS.some((p) => p.id === m)
          ? T.grupoDestacados
          : T.grupoTodos
      }
      const orden = [T.grupoConectados, T.grupoCli, T.grupoDestacados, T.grupoTodos]

      dialog.abrir({
        titulo: T.tituloMotor,
        opciones: motores
          .map((m) => ({ m, fam: familia(m) }))
          .sort((a, b) => orden.indexOf(a.fam) - orden.indexOf(b.fam))
          .map(({ m, fam }) => {
            const p = findProvider(m)
            const planes = p && p.planes.length > 1 ? ` · ${T.nPlanes(p.planes.length)}` : ""
            return opcion({
              value: m,
              title: m,
              category: fam,
              description: p ? `${p.label}${planes}` : "",
              current: m === engine,
            })
          }),
        onElegir: (o) => {
          if (o.value === engine) return
          ctx.cambiarMotor(o.value)
        },
      })
    },
  },
  {
    name: "session.clear",
    category: "agente",
    run: (ctx) => ctx.limpiar(),
  },
  {
    // Conectar un proveedor sin salir de acá.
    //
    // Antes la única forma era editar `~/.packetsmith/auth.json` a mano, que es
    // exactamente lo que esta app existe para no tener que hacer.
    name: "app.connect",
    category: "agente",
    run(ctx) {
      // Dos pasos, porque son dos preguntas distintas: A QUIÉN le hablás y CON
      // QUÉ PLAN. Kimi Code y la Open Platform son la misma empresa con dos
      // formas de cobrar; ofrecerlos como dos proveedores era mentir.
      const pedirCredencial = (provider: string, label: string, plan: Plan) => {
        if (plan.auth === "chatgpt") {
          dialog.cerrarTodo()
          ctx.conectarChatGPT(provider, plan.id, (url, codigo) => {
            ctx.decir(T.loginDispositivo(url, codigo))
          })
          return
        }
        dialog.abrir({
          titulo: `${provider} · ${plan.id}`,
          opciones: [],
          escribir: {
            ayuda: T.pegaLaKey(plan.consola),
            secreto: true,
            onAceptar(key) {
              if (!ctx.guardarKey(provider, plan.id, key)) { ctx.decir(T.noSePudoGuardar); return }
              ctx.decir(T.keyGuardada(`${label} · ${plan.label}`, provider))
            },
          },
        })
      }

      // Los mismos ciento cincuenta que `/engine`, con el mismo orden: lo que
      // ya conectaste arriba, los curados después, el resto al final.
      const destacados = new Set(PROVIDERS.map((p) => p.id))
      const familia = (id: string) =>
        ctx.hayKey(id) ? T.grupoConectados
        : destacados.has(id) ? T.grupoDestacados
        : T.grupoTodos
      const orden = [T.grupoConectados, T.grupoDestacados, T.grupoTodos]

      dialog.abrir({
        titulo: T.tituloProveedor,
        opciones: todosLosProveedores()
          .sort((a, b) => orden.indexOf(familia(a.id)) - orden.indexOf(familia(b.id)))
          .map((p) => opcion({
          value: p.id,
          title: p.id,
          category: familia(p.id),
          description: ctx.hayKey(p.id) ? `${p.label} — ${T.conectado}` : p.label,
          current: ctx.hayKey(p.id),
        })),
        onElegir(o) {
          const p = findProvider(o.value)!
          // Con un solo plan no hay nada que preguntar: preguntarlo igual sería
          // un paso que no decide nada.
          if (p.planes.length === 1) { pedirCredencial(p.id, p.label, p.planes[0]!); return }
          const actual = ctx.planDe(p.id)
          dialog.abrir({
            titulo: `${p.id} · ${T.tituloPlan}`,
            opciones: p.planes.map((pl) => opcion({
              value: pl.id,
              title: pl.id,
              description: pl.label,
              current: pl.id === actual,
            })),
            onElegir(e) {
              pedirCredencial(p.id, p.label, p.planes.find((x) => x.id === e.value)!)
            },
          })
        },
      })
    },
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
    // Cuánto va consumido del plan.
    //
    // Con una suscripción no hay precio por token que contar, así que sin esto
    // el plan es una caja negra hasta que te corta.
    name: "app.usage",
    category: "utilidad",
    run(ctx) {
      ctx.medidor().then((m) => {
        if (!m) { ctx.decir(T.sinMedidor); return }
        const filas: string[] = ["| | |", "|---|---|"]
        if (m.sesion !== undefined) filas.push(`| ${m.ventana ?? "ventana"} | ${Math.round(m.sesion)}% usado |`)
        if (m.semanal !== undefined) filas.push(`| total | ${Math.round(m.semanal)}% usado |`)
        if (m.reinicio) filas.push(`| se repone | ${new Date(m.reinicio * 1000).toLocaleString()} |`)
        if (m.nota) filas.push(`| | ${m.nota} |`)
        ctx.decir(filas.length > 2 ? filas.join("\n") : (m.nota ?? T.sinMedidor))
      })
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
