// Plano de la red con las coordenadas REALES del canvas de Packet Tracer.
//
// `pt_export_topology` y `pt_full_build` traen `x, y` de cada equipo: dónde
// está puesto en el lienzo. Eso alcanza para redibujar la disposición en
// caracteres —no una jerarquía inventada, la que el usuario ve en PT.
//
// Por qué al lado del árbol y no en su lugar: el árbol contesta "de qué cuelga
// esto", el plano contesta "cómo está armado". Un uplink que cruza de un
// extremo al otro del canvas se ve en el plano y es invisible en el árbol.
//
// Todo acá es puro: topología adentro, líneas de texto afuera. Eso permite
// testear el dibujo sin montar la interfaz.
import type { Topology } from "./model.ts"
import { ICON, kindOf } from "./model.ts"

/** Una celda pintada, con el tono que la UI le va a dar. */
export type Ink = "node" | "link" | "label"

export interface Cell {
  ch: string
  ink: Ink
}

/** Las celdas de una fila, ya agrupadas en tramos del mismo tono. */
export interface Span {
  text: string
  ink: Ink
}

/**
 * Carácter de línea según la pendiente.
 *
 * La diagonal se reserva para pendientes parecidas a 45°. Con una regla más
 * simple —cualquier pendiente que no sea recta va en diagonal— un enlace casi
 * horizontal salía como treinta `╱` seguidos, o sea una banda maciza en vez de
 * una línea.
 */
export function strokeFor(dx: number, dy: number): string {
  if (Math.abs(dx) >= 2 * Math.abs(dy)) return "─"
  if (Math.abs(dy) >= 2 * Math.abs(dx)) return "│"
  return dx * dy > 0 ? "╲" : "╱"
}

/**
 * Largo máximo de un nombre en el plano, y el margen que se reserva a la
 * derecha para que la etiqueta del nodo más a la derecha no se salga del marco.
 */
const LABEL_MAX = 12

/** Columnas libres a la derecha de un nodo antes del próximo de su misma fila. */
function gapRight(
  at: Map<string, { c: number; r: number }>,
  name: string,
  p: { c: number; r: number },
): number {
  let nearest = Infinity
  for (const [other, q] of at) {
    if (other === name || q.r !== p.r || q.c <= p.c) continue
    nearest = Math.min(nearest, q.c)
  }
  return nearest - p.c
}

/** Marco vacío de `w × h`. */
function blank(w: number, h: number): (Cell | undefined)[][] {
  return Array.from({ length: h }, () => new Array<Cell | undefined>(w).fill(undefined))
}

export interface MapOpts {
  width: number
  /** Tope de alto. El alto real sale de cuántas capas tenga la red. */
  maxHeight: number
}

/**
 * Dibuja el plano.
 *
 * Devuelve las filas ya en tramos por tono. Vacío si no hay coordenadas:
 * `pt_query_topology` devuelve todos los equipos en (0,0) y dibujarlos los
 * amontonaría a todos en una celda, que es peor que no dibujar nada.
 */
export function drawMap(topo: Topology, opts: MapOpts): Span[][] {
  const devices = topo.devices
  if (devices.length < 2) return []

  const xs = devices.map((d) => d.x)
  const ys = devices.map((d) => d.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  // Sin extensión en ningún eje no hay disposición que mostrar.
  if (maxX - minX === 0 && maxY - minY === 0) return []

  // El alto sale de cuántas alturas distintas usa la red, no de un número
  // fijo: una topología de dos capas en un marco de trece filas queda flotando
  // en un mar de espacio, y una de cuatro capas en cinco filas se aplasta.
  const layers = new Set(ys).size
  const w = Math.max(20, opts.width)
  const h = Math.min(Math.max(5, opts.maxHeight), Math.max(5, layers * 4 - 3))
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  const col = (x: number) => Math.round(((x - minX) / spanX) * (w - LABEL_MAX - 3))
  const row = (y: number) => Math.round(((y - minY) / spanY) * (h - 1))

  const grid = blank(w, h)
  const at = new Map<string, { c: number; r: number }>()
  for (const d of devices) at.set(d.name, { c: col(d.x), r: row(d.y) })

  const put = (c: number, r: number, ch: string, ink: Ink, force = false) => {
    if (r < 0 || r >= h || c < 0 || c >= w) return
    // Los enlaces nunca pisan un nodo ni una etiqueta: la línea es contexto, el
    // equipo es el dato.
    if (grid[r]![c] && !force) return
    grid[r]![c] = { ch, ink }
  }

  // Primero los enlaces, para que los nodos y las etiquetas los tapen.
  for (const l of topo.links) {
    const a = at.get(l.a.device)
    const b = l.b && at.get(l.b.device)
    if (!a || !b) continue

    const steps = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r))
    if (!steps) continue
    const ch = strokeFor(b.c - a.c, b.r - a.r)

    // Un paso por celda, y los extremos se saltean porque ahí van los nodos.
    // `steps` es el máximo de las dos distancias, así que la línea ya sale
    // continua: se probó recorrer en medios pasos y solo engrosó los trazos.
    for (let i = 1; i < steps; i++) {
      put(
        Math.round(a.c + ((b.c - a.c) * i) / steps),
        Math.round(a.r + ((b.r - a.r) * i) / steps),
        ch,
        "link",
      )
    }
  }

  for (const d of devices) {
    const p = at.get(d.name)!
    const kind = kindOf(d.model)
    put(p.c, p.r, ICON[kind], "node", true)
    // El hueco entre el ícono y el nombre se limpia a mano: si no, la diagonal
    // del enlace queda metida ahí y sale "▣╱SW-VENTAS".
    put(p.c + 1, p.r, " ", "label", true)

    // Solo se nombra la infraestructura. Los hosts van como punto: son los que
    // se amontonan —ocho en una fila salían pegados, "▪ PC-VEN1▪ PC-VEN2"— y
    // son justo los que el árbol del panel ya lista uno por uno con su IP. El
    // plano está para mostrar la FORMA, no para repetir el inventario.
    if (kind === "host" || kind === "other") continue

    // Igual se recorta a lo que haya hasta el vecino de la misma fila.
    const room = Math.min(LABEL_MAX, gapRight(at, d.name, p) - 3)
    if (room < 3) continue
    const name = d.name.slice(0, room)
    for (let i = 0; i < name.length; i++) put(p.c + 2 + i, p.r, name[i]!, "label", true)
  }

  return grid
    .map((line) => {
      const spans: Span[] = []
      for (const cell of line) {
        const ink = cell?.ink ?? "link"
        const ch = cell?.ch ?? " "
        const prev = spans[spans.length - 1]
        if (prev && prev.ink === ink) prev.text += ch
        else spans.push({ text: ch, ink })
      }
      // Se recorta el relleno de la derecha: filas de espacios hasta el borde
      // hacen que el bloque pese más de lo que dibuja.
      while (spans.length && !spans[spans.length - 1]!.text.trim()) spans.pop()
      return spans
    })
    // Filas vacías arriba y abajo no aportan; en el medio sí, son el espacio
    // real entre capas de la topología.
    .filter((spans, i, all) => spans.length || (i > 0 && i < all.length - 1 && all.some((s) => s.length)))
}
