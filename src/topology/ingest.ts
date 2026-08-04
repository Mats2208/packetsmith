// Convierte la salida de las tools pt_* en el modelo de topología.
//
// Escucha TRES tools porque el agente elige cuál usar según lo que esté
// haciendo, y en la práctica casi nunca llama a `pt_export_topology`:
//
//   pt_full_build       → trae el plan completo en JSON (equipos Y enlaces)
//   pt_export_topology  → texto formateado con equipos y enlaces
//   pt_query_topology   → texto con equipos, SIN enlaces
//
// v0.1 solo miraba `pt_export_topology`, así que un deploy real —que usa
// full_build y query_topology— dejaba el panel vacío aunque la red existiera.
import type { Device, Link, Port, Topology } from "./model.ts"
import { EMPTY } from "./model.ts"

// `  R1 [2911] @ (200, 90)`
const EXPORT_DEVICE = /^ {2}(\S+) \[([^\]]+)\] @ \((-?\d+), (-?\d+)\)$/
const EXPORT_PORT = /^ {4}(.+?)(?: IP=(\S+))?( \[linked\])?$/
const EXPORT_WIRED = /^ {2}(.+?):(.+?) {2}<--> {2}(.+?):(.+)$/
const EXPORT_WIRELESS = /^ {2}(.+?):(.+?) {2}\)\)\)/

// `  R1                   [2911]  (Vlan1,Gi0/0=10.0.0.1/255.255.255.252,Gi0/1)`
const QUERY_DEVICE = /^\s{2,}(\S+)\s+\[([^\]]+)\]\s+\((.*)\)\s*$/

/**
 * El `content` de un tool_result puede venir como string, como array de
 * bloques, o ya parseado. Y las tools del MCP envuelven todo en
 * `{"result": "..."}`, así que hay dos capas que destapar antes del texto.
 */
export function unwrapToolOutput(output: unknown): string {
  let value = output

  if (Array.isArray(value)) {
    value = value.map((b) => (typeof b === "object" && b && "text" in b ? (b as any).text : b)).join("")
  }
  if (typeof value !== "string") {
    value = JSON.stringify(value ?? "")
  }

  const text = value as string
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === "object" && typeof parsed.result === "string") {
      return parsed.result
    }
  } catch {
    // No era JSON: es texto plano y ya está listo.
  }
  return text
}

/** Parsea la salida de `pt_export_topology`. Null si no tiene esa forma. */
export function parseExportTopology(text: string): Topology | null {
  if (!text.includes("Topology Export")) return null

  const devices: Device[] = []
  const links: Link[] = []
  let current: Device | undefined
  let inLinks = false

  for (const line of text.split("\n")) {
    if (line.startsWith("--- Links ---")) {
      inLinks = true
      current = undefined
      continue
    }

    if (!inLinks) {
      const dev = EXPORT_DEVICE.exec(line)
      if (dev) {
        current = { name: dev[1]!, model: dev[2]!, x: Number(dev[3]), y: Number(dev[4]), ports: [] }
        devices.push(current)
        continue
      }
      const port = current && EXPORT_PORT.exec(line)
      if (port) {
        const p: Port = { name: port[1]!.trim(), linked: Boolean(port[3]) }
        if (port[2]) p.ip = port[2]
        current!.ports.push(p)
      }
      continue
    }

    const wireless = EXPORT_WIRELESS.exec(line)
    if (wireless) {
      links.push({ a: { device: wireless[1]!, port: wireless[2]! }, wireless: true })
      continue
    }
    const wired = EXPORT_WIRED.exec(line)
    if (wired) {
      links.push({
        a: { device: wired[1]!, port: wired[2]! },
        b: { device: wired[3]!, port: wired[4]! },
        wireless: false,
      })
    }
  }

  return { devices, links }
}

/**
 * Parsea `pt_query_topology`. Trae los equipos pero NO los enlaces, así que la
 * topología resultante no tiene jerarquía — el panel se adapta agrupando por
 * subred en vez de dibujar el árbol.
 */
export function parseQueryTopology(text: string): Topology | null {
  if (!/^DEVICES:\d+\|LINKS:\d+/m.test(text)) return null

  const devices: Device[] = []
  for (const line of text.split("\n")) {
    const m = QUERY_DEVICE.exec(line)
    if (!m) continue

    const ports: Port[] = []
    for (const raw of m[3]!.split(",")) {
      const [name, ip] = raw.split("=")
      if (!name?.trim()) continue
      const p: Port = { name: name.trim(), linked: Boolean(ip) }
      if (ip) p.ip = ip.trim()
      ports.push(p)
    }
    devices.push({ name: m[1]!, model: m[2]!, x: 0, y: 0, ports })
  }

  return devices.length ? { devices, links: [] } : null
}

/**
 * Extrae la topología del plan JSON que `pt_full_build` imprime al final.
 *
 * Es la mejor fuente de las tres: trae equipos, enlaces y coordenadas de una
 * sola vez, y es la tool que el agente usa para construir. El JSON viene
 * después de un encabezado de texto, así que hay que buscar dónde empieza.
 */
export function parseFullBuild(text: string): Topology | null {
  const start = text.indexOf('{\n  "name"')
  if (start === -1) return null

  let plan: any
  try {
    plan = JSON.parse(text.slice(start))
  } catch {
    return null
  }
  if (!Array.isArray(plan?.devices)) return null

  const devices: Device[] = plan.devices.map((d: any) => ({
    name: String(d.name ?? "?"),
    model: String(d.model ?? "?"),
    x: Number(d.x ?? 0),
    y: Number(d.y ?? 0),
    ports: Object.entries(d.interfaces ?? {}).map(([name, ip]) => ({
      name,
      ip: String(ip),
      linked: true,
    })),
  }))

  const links: Link[] = (plan.links ?? []).map((l: any) => ({
    a: { device: String(l.device_a), port: String(l.port_a) },
    b: { device: String(l.device_b), port: String(l.port_b) },
    wireless: false,
  }))

  return { devices, links }
}

/**
 * Actualiza la topología con el resultado de una tool.
 *
 * Devuelve la anterior si el resultado no aporta — un `pt_screenshot` o un
 * `pt_health_check` no cambian la red. Y nunca degrada: si ya hay una
 * topología con enlaces, un `pt_query_topology` (que no los trae) conserva
 * los que había en vez de dejar el árbol plano.
 */
export function ingest(current: Topology, toolName: string, output: unknown): Topology {
  if (!/pt_(full_build|export_topology|query_topology)/.test(toolName)) return current

  const text = unwrapToolOutput(output)
  const next =
    parseFullBuild(text) ?? parseExportTopology(text) ?? parseQueryTopology(text)
  if (!next) return current

  // query_topology no trae enlaces: si ya teníamos, se conservan.
  if (!next.links.length && current.links.length) {
    return { devices: next.devices, links: current.links }
  }
  return next
}

export { EMPTY }
