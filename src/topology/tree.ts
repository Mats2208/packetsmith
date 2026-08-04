// Arma la jerarquía que se dibuja en el panel: router → switches → hosts.
//
// PT no guarda ninguna jerarquía: da una lista plana de equipos y otra de
// enlaces. El árbol se deduce siguiendo los enlaces desde cada router, que es
// como se lee una topología de laboratorio.
import type { Device, Kind, Topology } from "./model.ts"
import { kindOf } from "./model.ts"

export interface Node {
  device: Device
  children: Node[]
}

/** Nombres de los equipos conectados a `name`, sin repetir. */
function neighbors(topo: Topology, name: string): string[] {
  const out = new Set<string>()
  for (const l of topo.links) {
    if (l.a.device === name && l.b) out.add(l.b.device)
    else if (l.b?.device === name) out.add(l.a.device)
  }
  return [...out]
}

/**
 * Construye el bosque. Un equipo se cuelga del primer padre que lo alcanza,
 * así que nunca aparece dos veces aunque tenga varios enlaces — si no, un
 * switch con dos uplinks saldría duplicado.
 */
export function buildForest(topo: Topology): Node[] {
  const byName = new Map(topo.devices.map((d) => [d.name, d]))
  const taken = new Set<string>()

  const attach = (d: Device): Node => {
    taken.add(d.name)
    const children: Node[] = []
    for (const n of neighbors(topo, d.name)) {
      const child = byName.get(n)
      if (!child || taken.has(child.name)) continue
      // Un router vecino es par, no hijo: cada uno encabeza su propia rama.
      if (kindOf(child.model) === "router") continue
      children.push(attach(child))
    }
    return { device: d, children }
  }

  const roots = topo.devices
    .filter((d) => kindOf(d.model) === "router")
    .sort((a, b) => a.x - b.x)
    .map(attach)

  // Lo que quedó suelto va al final: esconderlo haría que el panel mienta
  // sobre lo que hay en el canvas.
  const orphans = topo.devices.filter((d) => !taken.has(d.name)).map(attach)

  return [...roots, ...orphans]
}

/** Cuántos equipos hay de cada familia, para el censo del panel. */
export interface Tally {
  kind: Kind
  count: number
  /** Fracción sobre la familia más numerosa: es lo que dibuja la barra. */
  share: number
}

/**
 * Censo por familia, ya normalizado para dibujarlo como barras.
 *
 * Se escala contra el MÁXIMO y no contra el total: en un lab los hosts siempre
 * son mayoría, así que contra el total las barras de routers y switches quedan
 * en un muñón de una celda y dejan de comparar nada.
 */
export function censusOf(topo: Topology): Tally[] {
  const counts = new Map<Kind, number>()
  for (const d of topo.devices) {
    const k = kindOf(d.model)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  const max = Math.max(1, ...counts.values())
  return ORDER.filter((k) => counts.has(k)).map((kind) => ({
    kind,
    count: counts.get(kind)!,
    share: counts.get(kind)! / max,
  }))
}

/** De arriba hacia abajo de la pila: el orden en que se lee una topología. */
const ORDER: Kind[] = ["router", "switch", "wireless", "cloud", "host", "other"]

/** IPs de un equipo, sin la máscara, para que entren en el panel. */
export function addressesOf(d: Device): string[] {
  return d.ports.filter((p) => p.ip).map((p) => p.ip!.split("/")[0]!)
}

/** `192.168.0.5/255.255.255.0` → `192.168.0` — la /24 a la que pertenece. */
function subnetOf(ip: string): string {
  return ip.split("/")[0]!.split(".").slice(0, 3).join(".")
}

export interface Group {
  /** `192.168.0.0/24`, o "sin IP" para los equipos que no tienen ninguna. */
  label: string
  devices: Device[]
}

/**
 * Agrupa por subred, para cuando NO hay enlaces.
 *
 * `pt_query_topology` devuelve equipos sin enlaces, y una lista plana de 36
 * nombres no dice nada. Agrupar por /24 recupera la estructura que importa en
 * un lab: qué equipos comparten red.
 */
export function groupBySubnet(topo: Topology): Group[] {
  const groups = new Map<string, Device[]>()

  for (const d of topo.devices) {
    const ips = addressesOf(d)
    // Un equipo con varias IPs (un router) va en la primera: es su LAN.
    const key = ips.length ? `${subnetOf(ips[ips.length - 1]!)}.0/24` : "sin IP"
    const list = groups.get(key)
    if (list) list.push(d)
    else groups.set(key, [d])
  }

  return [...groups.entries()]
    .map(([label, devices]) => ({ label, devices }))
    // "sin IP" siempre al final: es lo menos informativo.
    .sort((a, b) => (a.label === "sin IP" ? 1 : b.label === "sin IP" ? -1 : a.label.localeCompare(b.label)))
}
