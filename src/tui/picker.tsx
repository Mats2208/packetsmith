// La paleta de comandos, como tablero.
//
// No es una lista con scroll y un filtro: es una grilla donde los catorce
// comandos están a la vista, agrupados por familia. Un buscador difuso resuelve
// bien el caso "sé cómo se llama y lo quiero ya", y resuelve mal el que importa
// más al principio: "no sé qué puedo pedirle a esto". Con pocos comandos, el
// repertorio completo delante es mejor interfaz que una caja de texto.
//
// Se dibuja a mano en vez de usar el `<select>` de OpenTUI porque `<select>` es
// una lista vertical de un solo color por fila, o sea lo contrario de esto.
//
// Lo que sí se aprovecha del teclado global: mientras hay un diálogo abierto,
// TODAS las teclas se atienden acá y se marcan como consumidas. El campo de
// escritura no pierde el foco ni se entera — no hay que sacárselo y devolverlo,
// que es donde estas cosas se rompen.
import { createMemo, createSignal, Index, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { bracket, C } from "./theme.ts"

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
  onElegir: (o: Opcion) => void
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
 * Espacio ENTRE opciones, fuera del resaltado.
 *
 * Va separado del relleno interno a propósito. Cuando todo era una sola cadena
 * —`●título` más dos espacios, todo con el fondo del resaltado— pasaban dos
 * cosas feas: el recuadro del elegido quedaba con un espacio a la izquierda y
 * dos a la derecha, y el punto del que está en uso se comía el relleno
 * izquierdo, así que `●ice` salía pegado al recuadro anterior.
 *
 * Ahora el hueco es de la fila, no de la opción, y el punto vive en el hueco.
 */
const HUECO = 1

/** Relleno adentro del resaltado, a cada lado del nombre. */
const RELLENO = 1

/**
 * Cuánto mide la columna de familias.
 *
 * Cero cuando no hay: los diálogos de tema, modelo y esfuerzo no tienen
 * familias, y dejarle quince columnas a una etiqueta que no existe es regalar
 * el espacio donde entrarían dos opciones más.
 */
export function anchoFamilia(opciones: Opcion[]): number {
  if (!opciones.some((o) => o.category)) return 1
  const masLarga = Math.max(0, ...opciones.map((o) => (o.category ?? "").length))
  return Math.min(16, masLarga + 2)
}

/**
 * Cuánto ocupa una opción dibujada: el punto de "en uso", el nombre, y el hueco.
 *
 * Las celdas se empaquetan según su contenido en vez de alinearse todas a la
 * más larga. Alineado, `/mcp` arrastraba ocho espacios detrás solo porque en
 * otro renglón existe `/topology`, y el tablero quedaba desparramado: mucho
 * aire entre cosas que se leen juntas. Empaquetado, cada renglón ocupa lo que
 * pesa. Se pierde la columna a plomo entre renglones distintos, y no importa —
 * lo que agrupa acá es la familia, no la columna.
 */
export const anchoOpcion = (o: Opcion) => HUECO + RELLENO + o.title.length + RELLENO

/** Cuántas opciones entran en un renglón, a partir de la primera. */
export function cuantasEntran(opciones: Opcion[], desde: number, disponible: number): number {
  let usado = 0
  let n = 0
  for (let i = desde; i < opciones.length; i++) {
    const w = anchoOpcion(opciones[i]!)
    if (n > 0 && usado + w > disponible) break
    usado += w
    n++
  }
  return Math.max(1, n)
}

export interface Fila {
  /** Vacío en los renglones de continuación de una familia larga. */
  familia: string
  /** Índices dentro de la lista filtrada, para que el cursor sea uno solo. */
  indices: number[]
}

/**
 * Arma los renglones: una familia por renglón, partida en varios si no entra.
 *
 * Se calcula acá y no se deja a `flexWrap` a propósito. Un renglón que envuelve
 * tiene alto variable, y una caja de alto variable sin declararlo es la trampa
 * de OpenTUI que ya está anotada dos veces en AGENTS.md: el bloque de abajo le
 * pisa la última fila. Partiendo a mano, cada renglón declara `height: 1` y no
 * hay nada que adivinar.
 */
export function filas(opciones: Opcion[], ancho: number): Fila[] {
  const disponible = Math.max(10, ancho - anchoFamilia(opciones) - 4)
  const out: Fila[] = []
  let i = 0

  while (i < opciones.length) {
    const familia = opciones[i]!.category ?? ""
    // Una familia por renglón: se corta donde cambia.
    let hasta = i
    while (hasta < opciones.length && (opciones[hasta]!.category ?? "") === familia) hasta++

    let primero = true
    while (i < hasta) {
      const n = Math.min(cuantasEntran(opciones, i, disponible), hasta - i)
      // Solo el primer renglón de una familia lleva su nombre: repetirlo en la
      // continuación haría parecer que son dos familias distintas.
      out.push({ familia: primero ? familia : "", indices: [...Array(n)].map((_, k) => i + k) })
      i += n
      primero = false
    }
  }

  return out
}

export function Picker(props: {
  /** Si el campo de escritura está vacío AHORA. Decide si `/` abre la lista. */
  draftVacio: () => boolean
  /** Ancho de la terminal: decide cuántas celdas entran por renglón. */
  ancho: () => number
}) {
  const activo = dialogoActivo
  const visibles = createMemo(() => (activo() ? filtrar(activo()!.opciones, filtro()) : []))
  // El ancho de la etiqueta sale del diálogo entero y no de lo filtrado: si
  // cambiara con cada tecla, el tablero se movería solo mientras escribís.
  const colFamilia = createMemo(() => anchoFamilia(activo()?.opciones ?? []))

  const mover = (delta: number) => {
    const lista = visibles()
    if (!lista.length) return
    const siguiente = (cursor() + delta + lista.length) % lista.length
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
    d.onElegir(o)
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

    switch (k.name) {
      case "escape": dialog.cerrar(true); return
      // En un tablero, ←→ es "el de al lado" y ⇅ es "la familia de arriba o de
      // abajo". Cuando hay una sola familia —los diálogos de tema, modelo o
      // esfuerzo— ⇅ vuelve a ser ±1, que es lo que la mano espera ahí.
      case "left": mover(-1); return
      case "right": mover(1); return
      case "up": saltarFamilia(-1); return
      case "down": saltarFamilia(1); return
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
        <Show
          when={visibles().length}
          fallback={
            <box style={{ height: 1 }}>
              <text style={{ fg: C.faint }}>{"  nada coincide"}</text>
            </box>
          }
        >
          {/* `Index` y no `For`: los renglones son POSICIONES, no identidades.
              Con `For`, cada tecla rehace el arreglo filtrado y sus elementos
              son objetos nuevos, así que Solid destruía y reinsertaba todas las
              cajas — y OpenTUI se quejaba en cada pulsación ("Anchor is the
              same as the node being inserted"). */}
          <Index each={filas(visibles(), props.ancho())}>
            {(fila) => (
              <box style={{ flexDirection: "row", height: 1 }}>
                {/* La familia va como etiqueta a la izquierda, en tono de
                    estructura: dice de qué es cada renglón sin gastarle uno. */}
                <text style={{ fg: C.faint, flexShrink: 0 }}>
                  {` ${fila().familia.toUpperCase().slice(0, colFamilia() - 1).padEnd(colFamilia())}`}
                </text>
                <Index each={fila().indices}>
                  {(i) => {
                    const o = () => visibles()[i()]!
                    const puesto = () => i() === cursor()
                    return (
                      <>
                        {/* El hueco es de la FILA, no de la opción, y el punto
                            del que está en uso vive acá adentro. Así el recuadro
                            del elegido queda con el mismo relleno de los dos
                            lados, y un `●` no se come el de la izquierda. */}
                        <text style={{ fg: C.brand, flexShrink: 0 }}>
                          {o().current ? "●" : " "}
                        </text>
                        <text
                          style={{
                            // El elegido se marca con FONDO. Un tercer color de
                            // texto sobre un tablero de dos tonos no se
                            // distinguiría de los otros dos.
                            bg: puesto() ? C.brand : undefined,
                            fg: puesto() ? C.panel : o().current ? C.brand : C.fg,
                            flexShrink: 0,
                          }}
                        >
                          {`${" ".repeat(RELLENO)}${o().title}${" ".repeat(RELLENO)}`}
                        </text>
                      </>
                    )
                  }}
                </Index>
              </box>
            )}
          </Index>
        </Show>

        {/* Lo que hace el elegido, en su propio renglón. En un tablero no entra
            una descripción por celda, y tampoco hace falta: la que importa es
            la de donde estás parado. */}
        <box style={{ flexDirection: "row", height: 1 }}>
          <text style={{ fg: C.dim, flexShrink: 0 }}>
            {` ${(visibles()[cursor()]?.description ?? "").slice(0, Math.max(0, props.ancho() - 30))}`}
          </text>
          <box style={{ flexGrow: 1 }} />
          {/* El filtro es del diálogo y no del campo de escritura: así se puede
              buscar sin ensuciar el mensaje que estabas redactando. */}
          <text style={{ fg: C.faint, flexShrink: 0 }}>
            {filtro() ? `${activo()!.prefijo ?? ""}${filtro()}` : ""}
          </text>
          <text style={{ fg: C.brand, flexShrink: 0 }}>{filtro() ? "█ " : ""}</text>
          <text style={{ fg: C.faint, flexShrink: 0 }}>{"←→ ⇅ ⏎ esc "}</text>
        </box>
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
