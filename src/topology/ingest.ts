// Convierte la salida de las tools pt_* en el modelo de topología.
//
// `pt_export_topology` dice devolver JSON pero devuelve texto formateado, así
// que hay que parsearlo. El formato lo fija tool_registry.py:
//
//   === Topology Export: 36 devices, 34 links ===
//
//     R1 [2911] @ (200, 90)
//       GigabitEthernet0/0 IP=10.0.0.1/255.255.255.252 [linked]
//     SW1 [3560-24PS] @ (200, 230)
//       GigabitEthernet0/1 [linked]
//
//   --- Links ---
//     R1:GigabitEthernet0/0  <-->  R2:GigabitEthernet0/0
//     AP1:Port 1  )))  [wireless signal]
import type { Device, Link, Port, Topology } from "./model.ts"
import { EMPTY } from "./model.ts"

const DEVICE = /^ {2}(\S+) \[([^\]]+)\] @ \((-?\d+), (-?\d+)\)$/
const PORT = /^ {4}(.+?)(?: IP=(\S+))?( \[linked\])?$/
const WIRED = /^ {2}(.+?):(.+?) {2}<--> {2}(.+?):(.+)$/
const WIRELESS = /^ {2}(.+?):(.+?) {2}\)\)\)/

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

/** Parsea la salida de `pt_export_topology`. Devuelve null si no tiene esa forma. */
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
      const dev = DEVICE.exec(line)
      if (dev) {
        current = {
          name: dev[1]!,
          model: dev[2]!,
          x: Number(dev[3]),
          y: Number(dev[4]),
          ports: [],
        }
        devices.push(current)
        continue
      }
      // Solo se listan los puertos con IP o con cable: PT reporta 26 puertos
      // por switch y volcarlos todos haría el panel inservible.
      const port = current && PORT.exec(line)
      if (port) {
        const p: Port = { name: port[1]!.trim(), linked: Boolean(port[3]) }
        if (port[2]) p.ip = port[2]
        current!.ports.push(p)
      }
      continue
    }

    const wireless = WIRELESS.exec(line)
    if (wireless) {
      links.push({ a: { device: wireless[1]!, port: wireless[2]! }, wireless: true })
      continue
    }
    const wired = WIRED.exec(line)
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
 * Actualiza la topología con el resultado de una tool.
 *
 * Devuelve la anterior si el resultado no aporta nada — un `pt_screenshot` o un
 * `pt_add_note` no cambian la red. Solo se reemplaza cuando llega una foto
 * completa; así el panel nunca queda a medias.
 */
export function ingest(current: Topology, toolName: string, output: unknown): Topology {
  if (!/pt_export_topology/.test(toolName)) return current

  const parsed = parseExportTopology(unwrapToolOutput(output))
  return parsed ?? current
}

export { EMPTY }
