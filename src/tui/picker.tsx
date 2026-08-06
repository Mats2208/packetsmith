// La paleta de comandos: una lista que se filtra mientras escribís.
//
// Se dibuja a mano en vez de usar el `<select>` de OpenTUI, y la razón es una
// sola: `<select>` pinta cada fila de UN color, y acá cada fila son dos cosas
// distintas —el comando y lo que hace—, que necesitan tonos distintos para que
// la lista se lea de un vistazo en vez de tener que leerla entera. El resto de
// esta interfaz también está dibujada a mano, así que tampoco desentona.
//
// Lo que sí se aprovecha del teclado global: mientras hay un diálogo abierto,
// TODAS las teclas se atienden acá y se marcan como consumidas. El campo de
// escritura no pierde el foco ni se entera — no hay que sacárselo y devolverlo,
// que es donde estas cosas se rompen.
import { createMemo, createSignal, Index, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { C } from "./theme.ts"

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

/** Las opciones que sobreviven al filtro, mejor puntaje primero. */
export function filtrar(opciones: Opcion[], consulta: string): Opcion[] {
  if (!consulta) return opciones
  return opciones
    .map((o) => {
      // Se mira el título Y la descripción: buscar "tema" tiene que encontrar
      // `/theme` aunque el comando esté en inglés.
      const a = puntaje(o.title, consulta)
      const b = o.description ? puntaje(o.description, consulta) : undefined
      const p = Math.max(a ?? -Infinity, b !== undefined ? b - 200 : -Infinity)
      return { o, p }
    })
    .filter((x) => x.p > -Infinity)
    .sort((a, b) => b.p - a.p)
    .map((x) => x.o)
}

// ── Dibujo ─────────────────────────────────────────────────────────────────

/** Cuántas filas se ven de una. Más que esto le come la pantalla al chat. */
const VISIBLES = 10

/** Ventana de la lista alrededor del cursor, para que no se salga por abajo. */
export function ventana(total: number, cursor: number, alto = VISIBLES): [number, number] {
  if (total <= alto) return [0, total]
  const medio = Math.floor(alto / 2)
  const desde = Math.max(0, Math.min(cursor - medio, total - alto))
  return [desde, desde + alto]
}

export function Picker(props: {
  /** Si el campo de escritura está vacío AHORA. Decide si `/` abre la lista. */
  draftVacio: () => boolean
}) {
  const activo = dialogoActivo
  const visibles = createMemo(() => (activo() ? filtrar(activo()!.opciones, filtro()) : []))

  const mover = (delta: number) => {
    const lista = visibles()
    if (!lista.length) return
    const siguiente = (cursor() + delta + lista.length) % lista.length
    setCursor(siguiente)
    activo()?.onMover?.(lista[siguiente]!)
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
      case "up": mover(-1); return
      case "down": mover(1); return
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
        title={` ${activo()!.titulo.toUpperCase()} `}
        titleAlignment="left"
      >
        <Show
          when={visibles().length}
          fallback={<text style={{ fg: C.faint }}>{"  sin resultados"}</text>}
        >
          {/* `Index` y no `For`: las filas son POSICIONES, no identidades. Con
              `For`, cada tecla rehace el arreglo filtrado y sus elementos son
              objetos nuevos, así que Solid destruía y reinsertaba todas las
              cajas — y OpenTUI se quejaba en cada pulsación ("Anchor is the
              same as the node being inserted"). `Index` conserva las filas y
              solo cambia lo que dicen. */}
          <Index each={visibles().slice(...ventana(visibles().length, cursor()))}>
            {(o, i) => {
              const real = () => ventana(visibles().length, cursor())[0] + i
              const puesto = () => real() === cursor()
              return (
                <box
                  style={{
                    flexDirection: "row",
                    height: 1,
                    // La fila marcada se resalta con FONDO y no con un color de
                    // texto: sobre una lista de dos tonos, un tercer tono no se
                    // distingue de los otros dos.
                    backgroundColor: puesto() ? C.brand : C.panel,
                  }}
                >
                  <text style={{ fg: puesto() ? C.panel : C.fg, flexShrink: 0 }}>
                    {` ${o().current ? "●" : " "} ${o().title.padEnd(14)}`}
                  </text>
                  <text style={{ fg: puesto() ? C.panel : C.dim, flexShrink: 0 }}>
                    {o().description ?? ""}
                  </text>
                </box>
              )
            }}
          </Index>
        </Show>

        {/* La línea de filtro es del diálogo, no del campo de escritura: así se
            puede filtrar sin ensuciar el mensaje que estabas redactando. */}
        <box style={{ flexDirection: "row", height: 1 }}>
          <text style={{ fg: C.brand, flexShrink: 0 }}>{` ${activo()!.prefijo ?? ""}`}</text>
          <text style={{ fg: C.fg, flexShrink: 0 }}>{filtro()}</text>
          <text style={{ fg: C.brand, flexShrink: 0 }}>{"█"}</text>
          <box style={{ flexGrow: 1 }} />
          <text style={{ fg: C.faint, flexShrink: 0 }}>
            {`${visibles().length} · ↑↓ mover · ⏎ elegir · esc salir `}
          </text>
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
