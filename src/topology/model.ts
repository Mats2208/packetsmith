// Modelo de la red. Se deriva de lo que devuelven las tools pt_*; no hay
// estado propio ni caché: la verdad vive en Packet Tracer.

export interface Port {
  name: string
  /** "192.168.0.1/255.255.255.0" tal cual lo reporta PT, o undefined si no tiene. */
  ip?: string
  linked: boolean
}

export interface Device {
  name: string
  model: string
  x: number
  y: number
  ports: Port[]
}

export interface Link {
  a: { device: string; port: string }
  /** Los enlaces inalámbricos no tienen extremo B: PT los modela como antena. */
  b?: { device: string; port: string }
  wireless: boolean
}

export interface Topology {
  devices: Device[]
  links: Link[]
}

export const EMPTY: Topology = { devices: [], links: [] }

/** Familia del dispositivo, deducida del modelo. Decide el ícono y el orden. */
export type Kind = "router" | "switch" | "host" | "wireless" | "cloud" | "other"

export function kindOf(model: string): Kind {
  const m = model.toLowerCase()

  // El prefijo "29" es ambiguo: 2901 y 2911 son routers, 2950 y 2960 son
  // switches. Por eso se compara el tercer dígito y los switches van primero.
  if (/^(29[56]|3[56]|ie-|switch)/.test(m)) return "switch"
  if (/^(18|19|26[23]|28|29[01]|8[12]9|cgr|isr|router)/.test(m)) return "router"
  if (/(accesspoint|-ap$|wrt|homerouter|lap-)/.test(m)) return "wireless"
  if (/(cloud|modem|cell-tower)/.test(m)) return "cloud"
  if (/(pc-pt|laptop|server|tablet|smartphone|printer|-pt$)/.test(m)) return "host"
  return "other"
}

export const ICON: Record<Kind, string> = {
  router: "◆",
  switch: "▣",
  host: "▪",
  wireless: "◌",
  cloud: "☁",
  other: "·",
}
