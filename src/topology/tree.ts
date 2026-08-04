// Arma la jerarquía que se dibuja en el panel: router → switches → hosts.
//
// PT no guarda ninguna jerarquía: da una lista plana de dispositivos y otra de
// enlaces. El árbol se deduce siguiendo los enlaces desde cada router, que es
// como se lee una topología de laboratorio.
import type { Device, Topology } from "./model.ts"
import { kindOf } from "./model.ts"

export interface Node {
  device: Device
  children: Node[]
}

/** Nombres de los dispositivos conectados a `name`, sin repetir. */
function neighbors(topo: Topology, name: string): string[] {
  const out = new Set<string>()
  for (const l of topo.links) {
    if (l.a.device === name && l.b) out.add(l.b.device)
    else if (l.b?.device === name) out.add(l.a.device)
  }
  return [...out]
}

/**
 * Construye el bosque. Un dispositivo se cuelga del primer padre que lo
 * alcanza, así que nunca aparece dos veces aunque tenga varios enlaces —
 * si no, un switch con dos uplinks saldría duplicado.
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

  // Los routers primero y de izquierda a derecha, que es como están en el
  // canvas de PT: así el panel y la pantalla de PT se leen igual.
  const roots = topo.devices
    .filter((d) => kindOf(d.model) === "router")
    .sort((a, b) => a.x - b.x)
    .map(attach)

  // Lo que quedó suelto (un switch sin router, un equipo sin cablear) va al
  // final: esconderlo haría que el panel mienta sobre lo que hay en el canvas.
  const orphans = topo.devices.filter((d) => !taken.has(d.name)).map(attach)

  return [...roots, ...orphans]
}

/** IPs de un dispositivo, sin la máscara, para que entren en el panel. */
export function addressesOf(d: Device): string[] {
  return d.ports
    .filter((p) => p.ip)
    .map((p) => p.ip!.split("/")[0]!)
}
