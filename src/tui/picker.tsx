/** @jsxImportSource @opentui/solid */
// La paleta de comandos.
//
// Fue un tablero —todos los comandos a la vista, agrupados por familia, en dos
// renglones— y era lindo de ver y molesto de usar. Con un tablero, ←→ es "el de
// al lado" y ⇅ es "otra familia", así que moverse entre dos opciones que se
// leen juntas podía costar un salto de familia y volver. La mano espera que ⇅
// recorra opciones, no categorías.
//
// Ahora es una LISTA, pero no una lista pelada:
//
//   · una fila por opción, con su descripción al lado — antes solo se veía la
//     de donde estabas parado, así que comparar dos era ir y venir;
//   · encabezado de familia donde cambia, que da el mismo agrupamiento que
//     daba el tablero sin costar la navegación;
//   · ventana con desplazamiento y un contador `3/16`, porque con models.dev
//     hay listas de cuarenta modelos y el tablero directamente no entraba;
//   · el filtro tipeado a la vista arriba, no escondido en un rincón.
//
// Se dibuja a mano en vez de usar el `<select>` de OpenTUI porque hace falta el
// encabezado de familia intercalado y dos colores por fila, y `<select>` da una
// fila plana de un color.
//
// Lo que sí se aprovecha del teclado global: mientras hay un diálogo abierto,
// TODAS las teclas se atienden acá y se marcan como consumidas. El campo de
// escritura no pierde el foco ni se entera — no hay que sacárselo y devolverlo,
// que es donde estas cosas se rompen.
import { createMemo, createSignal, Index, Show } from "solid-js"
import { useKeyboard, usePaste } from "@opentui/solid"
import type { KeyEvent, PasteEvent } from "@opentui/core"
import { bracket, C } from "./theme.ts"
import { T } from "./i18n.ts"

export interface Opcion {
  /** Lo que se tipea o elige. Es lo que vuelve en `onElegir`. */
  value: string
  /** Columna izquierda, encendida. */
  title: string
  /** Columna derecha, apagada. Qué hace. */
  description?: string
  /** Agrupa visualmente. Las opciones ya vienen ordenadas por quien las arma. */
  category?: string
  /** Se marca con un punto: es el valor en uso ahora. */
  current?: boolean
}

export interface Dialogo {
  /** Va en el marco. Dice qué se está eligiendo. */
  titulo: string
  opciones: Opcion[]
  /** Opcional: un diálogo de ESCRIBIR no tiene nada que elegir. */
  onElegir?: (o: Opcion) => void
  /**
   * Se llama al MOVERSE, antes de elegir. Es lo que permite previsualizar un
   * tema mientras se recorre la lista en vez de tener que confirmarlo para ver
   * cómo queda.
   */
  onMover?: (o: Opcion) => void
  /** Se llama si se sale con Esc. Para revertir lo que `onMover` haya hecho. */
  onCancelar?: () => void
  /** Prefijo de la línea de filtro. `/` para la paleta, vacío para el resto. */
  prefijo?: string
  /**
   * Convierte el diálogo en uno de ESCRIBIR en vez de elegir.
   *
   * Existe por una razón concreta: pegar una API key. Mandar a alguien a editar
   * un archivo a mano es justo lo que esta app está para evitar, y sin esto
   * `/connect` no podía existir.
   */
  escribir?: {
    /** Qué se pide, en una línea. */
    ayuda: string
    /** Se dibuja con puntos y solo se muestran los últimos cuatro. */
    secreto?: boolean
    onAceptar(valor: string): void
  }
}

/**
 * Un secreto, dibujado.
 *
 * Se ven los últimos cuatro caracteres y nada más. Ocultarlo entero deja sin
 * forma de notar que se pegó de más o de menos; mostrarlo entero lo deja en
 * pantalla, que es donde no tiene que estar.
 */
export function enmascarar(v: string): string {
  if (v.length <= 4) return "•".repeat(v.length)
  return "•".repeat(Math.min(v.length - 4, 24)) + v.slice(-4)
}

// ── La pila ────────────────────────────────────────────────────────────────
//
// Es una pila y no un solo diálogo porque un comando puede abrir otro: `/model`
// lleva a la lista de modelos. Reemplazar en vez de apilar sería perder el
// camino de vuelta.

const [pila, setPila] = createSignal<Dialogo[]>([])
const [filtro, setFiltro] = createSignal("")
const [cursor, setCursor] = createSignal(0)

/** El diálogo de arriba de todo, o undefined si no hay ninguno. */
export const dialogoActivo = () => pila().at(-1)
/** Si hay algo abierto. La UI lo usa para saber si tiene que ceder el teclado. */
export const hayDialogo = () => pila().length > 0

export const dialog = {
  /** Abre uno nuevo encima del que haya. */
  abrir(d: Dialogo) {
    setPila((p) => [...p, d])
    setFiltro("")
    setCursor(0)
  },
  /** Cambia el de arriba. Para encadenar sin dejar rastro del anterior. */
  reemplazar(d: Dialogo) {
    setPila((p) => [...p.slice(0, -1), d])
    setFiltro("")
    setCursor(0)
  },
  /** Cierra el de arriba. `cancelado` dispara el `onCancelar` del diálogo. */
  cerrar(cancelado = false) {
    const d = dialogoActivo()
    if (cancelado) d?.onCancelar?.()
    setPila((p) => p.slice(0, -1))
    setFiltro("")
    setCursor(0)
  },
  cerrarTodo() {
    setPila([])
    setFiltro("")
    setCursor(0)
  },
}

// ── Filtrado ───────────────────────────────────────────────────────────────

/**
 * Puntaje de una opción contra lo tipeado. `undefined` = no matchea.
 *
 * Difuso pero con jerarquía, y el orden importa: prefijo primero, después
 * subcadena, y recién al final letras salteadas. Sin esa jerarquía, tipear
 * "mo" en una lista con `/model` y `/move` es una lotería — y es exactamente el
 * caso que se da con dos comandos que empiezan igual.
 *
 * No se usa una librería de fuzzy porque son veinte comandos: la dependencia
 * costaría más que el problema que resuelve.
 */
export function puntaje(texto: string, consulta: string): number | undefined {
  if (!consulta) return 0
  const t = texto.toLowerCase()
  const q = consulta.toLowerCase()

  if (t.startsWith(q)) return 1000 - t.length
  const dentro = t.indexOf(q)
  if (dentro !== -1) return 500 - dentro

  // Letras salteadas, en orden. Premia que estén juntas.
  let i = 0
  let saltos = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    else if (i > 0 && i < q.length) saltos++
    if (i === q.length) break
  }
  return i === q.length ? 100 - Math.min(saltos, 99) : undefined
}

/**
 * Las opciones que sobreviven al filtro.
 *
 * Ordenadas por puntaje pero SIN romper las familias: primero va la familia que
 * tenga el mejor resultado, y adentro de cada una los suyos por puntaje. Un
 * orden global por puntaje deja las familias intercaladas, y en un tablero eso
 * se ve como una fila por comando —cada cambio de familia abre un renglón—, que
 * es justo lo que el agrupado viene a evitar.
 */
export function filtrar(opciones: Opcion[], consulta: string): Opcion[] {
  if (!consulta) return opciones

  const puntuadas = opciones
    .map((o) => {
      // Se mira el título Y la descripción: buscar "tema" tiene que encontrar
      // `/theme` aunque el comando esté en inglés. La descripción vale menos:
      // que el nombre coincida es una señal más fuerte.
      const a = puntaje(o.title, consulta)
      const b = o.description ? puntaje(o.description, consulta) : undefined
      const p = Math.max(a ?? -Infinity, b !== undefined ? b - 200 : -Infinity)
      return { o, p }
    })
    .filter((x) => x.p > -Infinity)

  const mejorDe = new Map<string, number>()
  for (const { o, p } of puntuadas) {
    const fam = o.category ?? ""
    mejorDe.set(fam, Math.max(mejorDe.get(fam) ?? -Infinity, p))
  }

  return puntuadas
    .sort((a, b) => {
      const fa = mejorDe.get(a.o.category ?? "")!
      const fb = mejorDe.get(b.o.category ?? "")!
      return fb !== fa ? fb - fa : b.p - a.p
    })
    .map((x) => x.o)
}

// ── Dibujo ─────────────────────────────────────────────────────────────────
//
// No es una lista con scroll sino un TABLERO: los comandos entran todos de una,
// agrupados por familia, una familia por renglón. La diferencia no es estética.
// Una lista de diez con filtro te obliga a recordar qué había abajo y a confiar
// en que el filtro encuentre lo que ni sabés cómo se llama; un tablero te
// muestra el repertorio completo y podés elegir mirando. Con catorce comandos,
// esconderlos detrás de un scroll era regalar la única ventaja que hay: que son
// pocos.
//
// Como efecto secundario ocupa la mitad de alto, que en una app partida en dos
// paneles es alto que le devolvés a la conversación.

/**
 * Cuántas filas de lista se muestran a la vez.
 *
 * Es una ventana y no la lista entera porque la app está partida en dos paneles
 * y el alto es caro: `/model` con models.dev puede traer cuarenta modelos, y
 * cuarenta filas taparían la conversación entera. Ocho deja ver el contexto de
 * arriba y abajo del cursor sin comerse la pantalla.
 */
export const VENTANA = 8

/** Ancho de la columna de títulos. El resto es para la descripción. */
export const COL_TITULO = 14

export type Entrada =
  /** Encabezado de familia. No se puede elegir ni cuenta para el cursor. */
  | { tipo: "familia"; texto: string }
  /** Una opción. `i` es su índice en la lista filtrada. */
  | { tipo: "opcion"; i: number }

/**
 * Qué filas se dibujan, ya desplazadas para que el cursor se vea.
 *
 * Es puro y exportado porque acá vive lo que se puede romper sin que se note:
 * un desplazamiento mal calculado deja el cursor fuera de la ventana y la lista
 * parece trabada. Con esto se prueba sin montar nada.
 */
export function listado(opciones: Opcion[], cursor: number, alto = VENTANA): Entrada[] {
  // Primero la lista completa, con los encabezados donde cambia la familia.
  const todo: Entrada[] = []
  let ultima: string | undefined
  opciones.forEach((o, i) => {
    const fam = o.category ?? ""
    if (fam && fam !== ultima) todo.push({ tipo: "familia", texto: fam })
    ultima = fam
    todo.push({ tipo: "opcion", i })
  })
  if (todo.length <= alto) return todo

  // El cursor se mantiene DENTRO de la ventana con un margen: pegarlo al borde
  // hace que no se vea qué viene, que es justo lo que uno mira antes de moverse.
  const fila = todo.findIndex((e) => e.tipo === "opcion" && e.i === cursor)
  const margen = 2
  let desde = Math.min(Math.max(0, fila - margen), todo.length - alto)
  desde = Math.max(0, Math.min(desde, todo.length - alto))
  // Un encabezado suelto arriba de todo no dice de qué grupo es lo que sigue si
  // se cortó justo debajo; empezar una fila antes lo recupera.
  if (desde > 0 && todo[desde]?.tipo === "opcion" && todo[desde - 1]?.tipo === "familia") desde--
  return todo.slice(desde, desde + alto)
}

export function Picker(props: {
  /** Si el campo de escritura está vacío AHORA. Decide si `/` abre la lista. */
  draftVacio: () => boolean
  /** Ancho de la terminal: decide cuántas celdas entran por renglón. */
  ancho: () => number
}) {
  const activo = dialogoActivo
  const visibles = createMemo(() => (activo() ? filtrar(activo()!.opciones, filtro()) : []))
  const entradas = createMemo(() => listado(visibles(), cursor()))
  /** Cuánto le queda a la descripción después del título y los márgenes. */
  const anchoDesc = () => Math.max(8, props.ancho() - COL_TITULO - 10)

  const mover = (delta: number) => {
    const lista = visibles()
    if (!lista.length) return
    // De a uno da la vuelta —bajar en la última lleva a la primera, que es lo
    // que la mano espera—; de a una página se topa con el borde, porque dar la
    // vuelta entera al apretar PgDn desorienta.
    const siguiente = Math.abs(delta) === 1
      ? (cursor() + delta + lista.length) % lista.length
      : Math.max(0, Math.min(lista.length - 1, cursor() + delta))
    setCursor(siguiente)
    activo()?.onMover?.(lista[siguiente]!)
  }

  /** Salta al primer comando de la familia anterior o la siguiente. */
  const saltarFamilia = (delta: number) => {
    const lista = visibles()
    if (!lista.length) return
    const grupos = [...new Set(lista.map((o) => o.category ?? ""))]
    if (grupos.length < 2) { mover(delta); return }

    const actual = grupos.indexOf(lista[cursor()]?.category ?? "")
    const destino = grupos[(actual + delta + grupos.length) % grupos.length]
    const i = lista.findIndex((o) => (o.category ?? "") === destino)
    if (i === -1) return
    setCursor(i)
    activo()?.onMover?.(lista[i]!)
  }

  const elegir = () => {
    const o = visibles()[cursor()]
    if (!o) return
    const d = activo()!
    // Se cierra ANTES de ejecutar: si el comando abre otro diálogo, tiene que
    // encontrar la pila sin el suyo. Al revés se cerraba el que él acababa de
    // abrir y no pasaba nada, que es un bug precioso de diagnosticar.
    dialog.cerrar()
    d.onElegir?.(o)
  }

  useKeyboard((k: KeyEvent) => {
    if (!hayDialogo()) {
      // `/` en un campo vacío abre la paleta, y Ctrl+P la abre siempre. Los dos
      // caminos terminan en el mismo lugar, así que la lógica es una sola.
      const abre = (k.name === "/" && props.draftVacio()) ||
        (k.ctrl && (k.name === "p" || k.name === "P"))
      if (abre) {
        k.preventDefault()
        abrirPaleta()
      }
      return
    }

    // Con un diálogo abierto TODO se atiende acá. Si algo se escapara, iría al
    // campo de escritura, que sigue con el foco puesto.
    k.preventDefault()

    // Escribir es otro juego: no hay lista que recorrer y Enter confirma.
    const esc = activo()?.escribir
    if (esc) {
      if (k.name === "escape") { dialog.cerrar(true); return }
      if (k.name === "return" || k.name === "kpenter") {
        const v = filtro().trim()
        if (!v) return
        dialog.cerrar()
        esc.onAceptar(v)
        return
      }
      if (k.name === "backspace") { setFiltro((f) => f.slice(0, -1)); return }
      if (k.sequence && k.sequence.length === 1 && k.sequence >= " " && !k.ctrl && !k.meta) {
        setFiltro((f) => f + k.sequence)
      }
      return
    }

    switch (k.name) {
      case "escape": dialog.cerrar(true); return
      // En una lista, ⇅ es "la de arriba o la de abajo" y nada más. Era al revés
      // cuando esto era un tablero, y ese cruce es lo que lo hacía incómodo.
      case "up": mover(-1); return
      case "down": mover(1); return
      // ←→ salta de familia, que es el atajo que el tablero daba gratis. Sin
      // familias no hay nada que saltar y vuelve a ser ±1.
      case "left": saltarFamilia(-1); return
      case "right": saltarFamilia(1); return
      // Página entera, para listas largas de verdad — cuarenta modelos.
      case "pageup": mover(-VENTANA); return
      case "pagedown": mover(VENTANA); return
      case "home": setCursor(0); activo()?.onMover?.(visibles()[0]!); return
      case "end": {
        const ultimo = visibles().length - 1
        if (ultimo >= 0) { setCursor(ultimo); activo()?.onMover?.(visibles()[ultimo]!) }
        return
      }
      case "return":
      case "kpenter": elegir(); return
      case "tab": {
        // Completa hasta la opción marcada, para poder seguir tipeando.
        const o = visibles()[cursor()]
        if (o) { setFiltro(o.title.replace(/^\//, "")); setCursor(0) }
        return
      }
      case "backspace": {
        if (!filtro()) { dialog.cerrar(true); return }
        setFiltro((f) => f.slice(0, -1))
        setCursor(0)
        return
      }
    }

    // Cualquier carácter imprimible filtra.
    if (k.sequence && k.sequence.length === 1 && k.sequence >= " " && !k.ctrl && !k.meta) {
      setFiltro((f) => f + k.sequence)
      setCursor(0)
    }
  })

  // Una API key se PEGA. El pegado llega como un evento propio y no como una
  // ráfaga de teclas, así que sin esto el diálogo de escribir quedaba vacío.
  usePaste((ev: PasteEvent) => {
    if (!hayDialogo()) return
    // Se consume SIEMPRE que haya un diálogo abierto, escriba o no.
    //
    // Sin esto el pegado llegaba a los dos lados: la key entraba en el diálogo
    // y ADEMÁS quedaba escrita en el campo del mensaje, a la vista y lista para
    // mandarse al agente sin querer. Es el mismo motivo por el que las teclas
    // se consumen con un diálogo abierto, y se me había escapado justo en el
    // caso donde el dato es secreto.
    ev.preventDefault()
    ev.stopPropagation()

    const esc = activo()?.escribir
    if (!esc) return
    // Llega como bytes crudos, no como texto. Y se le sacan espacios y saltos,
    // porque una key copiada de una web suele venir con un salto al final y eso
    // ya no es la misma cadena.
    const texto = new TextDecoder().decode(ev.bytes).replace(/\s+/g, "")
    if (texto) setFiltro((f) => f + texto)
  })

  return (
    <Show when={activo()}>
      {/* Va ARRIBA del campo de escritura y debajo de la barra de estado. No
          puede ir después de un scrollbox: en esta versión de OpenTUI el
          scrollbox se queda con todo el alto que sobra y lo de después nunca se
          dibuja. */}
      <box
        style={{
          flexDirection: "column",
          marginLeft: 1,
          marginRight: 1,
          flexShrink: 0,
          border: true,
          borderColor: C.line,
          backgroundColor: C.panel,
        }}
        // `[ COMANDOS ]` y no `COMANDOS` a secas: es el mismo framing que usa
        // el panel de topología. Detalles así son los que hacen que las tres
        // zonas se lean como un aparato y no como tres widgets juntos.
        title={` ${bracket(activo()!.titulo)} `}
        titleAlignment="left"
      >
        {/* Modo escribir: ni tablero ni filtro, una línea y listo. */}
        <Show when={activo()!.escribir}>
          <box style={{ flexDirection: "row", height: 1 }}>
            <text style={{ fg: C.brand, flexShrink: 0 }}>{"  › "}</text>
            <text style={{ fg: C.fg, flexShrink: 0 }}>
              {activo()!.escribir!.secreto ? enmascarar(filtro()) : filtro()}
            </text>
            <text style={{ fg: C.brand, flexShrink: 0 }}>{"█"}</text>
          </box>
          <box style={{ flexDirection: "row", height: 1 }}>
            <text style={{ fg: C.dim, flexShrink: 0 }}>{`  ${activo()!.escribir!.ayuda}`}</text>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: C.faint, flexShrink: 0 }}>{"⏎ esc "}</text>
          </box>
        </Show>

        {/* La línea de filtro va ARRIBA y siempre visible. Antes vivía abajo a
            la derecha y solo aparecía si habías tipeado algo, así que mientras
            buscabas no se veía qué estabas buscando. */}
        <Show when={!activo()!.escribir}>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
            <text style={{ fg: C.brand, flexShrink: 0 }}>{"  › "}</text>
            <text style={{ fg: C.fg, flexShrink: 0 }}>
              {`${activo()!.prefijo ?? ""}${filtro()}`}
            </text>
            <text style={{ fg: C.brand, flexShrink: 0 }}>{"█"}</text>
            <box style={{ flexGrow: 1 }} />
            {/* Cuántas hay y en cuál estás. Con una ventana con scroll, sin
                esto no hay forma de saber si abajo queda algo. */}
            <text style={{ fg: C.faint, flexShrink: 0 }}>
              {visibles().length ? `${cursor() + 1}/${visibles().length}  ` : "  "}
            </text>
          </box>
        </Show>

        <Show
          when={!activo()!.escribir && visibles().length}
          fallback={
            <Show when={!activo()!.escribir}>
              <box style={{ height: 1 }}>
                <text style={{ fg: C.faint }}>{T.nadaCoincide}</text>
              </box>
            </Show>
          }
        >
          {/* `Index` y no `For`: las filas son POSICIONES, no identidades. Con
              `For`, cada tecla rehace el arreglo filtrado y sus elementos son
              objetos nuevos, así que Solid destruía y reinsertaba todas las
              cajas — y OpenTUI se quejaba en cada pulsación ("Anchor is the same
              as the node being inserted"). */}
          <Index each={entradas()}>
            {(entrada) => (
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <Show
                  when={entrada().tipo === "opcion"}
                  fallback={
                    // Encabezado de familia: da el agrupamiento que daba el
                    // tablero sin costar la navegación.
                    <text style={{ fg: C.faint, flexShrink: 0 }}>
                      {`  ${(entrada() as { texto: string }).texto.toUpperCase()}`}
                    </text>
                  }
                >
                  {(() => {
                    const i = () => (entrada() as { i: number }).i
                    const o = () => visibles()[i()]!
                    const puesto = () => i() === cursor()
                    return (
                      <>
                        {/* La cuña marca dónde estás; el punto, qué está en uso.
                            Son dos cosas distintas y por eso son dos glifos. */}
                        <text style={{ fg: C.brand, flexShrink: 0 }}>
                          {puesto() ? " ▸ " : o().current ? " ● " : "   "}
                        </text>
                        <text
                          style={{
                            bg: puesto() ? C.brand : undefined,
                            fg: puesto() ? C.panel : o().current ? C.brand : C.fg,
                            flexShrink: 0,
                          }}
                        >
                          {` ${o().title.slice(0, COL_TITULO).padEnd(COL_TITULO)} `}
                        </text>
                        {/* La descripción va en TODAS las filas, no solo en la
                            del cursor: comparar dos opciones era ir y venir. */}
                        <text style={{ fg: puesto() ? C.dim : C.faint, flexShrink: 0 }}>
                          {`  ${(o().description ?? "").slice(0, anchoDesc())}`}
                        </text>
                      </>
                    )
                  })()}
                </Show>
              </box>
            )}
          </Index>
        </Show>

        <Show when={!activo()!.escribir}>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: C.faint, flexShrink: 0 }}>{T.ayudaTeclas}</text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Quién arma la paleta de comandos.
 *
 * Lo inyecta `app.tsx` al montarse, porque los comandos necesitan tocar el
 * estado de la app y este archivo no tiene por qué saber cuál es. Sin esto,
 * `picker.tsx` tendría que importar medio `app.tsx` y quedarían enredados.
 */
let abrirPaleta: () => void = () => {}
export function registrarPaleta(fn: () => void) {
  abrirPaleta = fn
}
