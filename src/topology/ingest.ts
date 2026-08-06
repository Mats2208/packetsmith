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

// `  R1 [2911] @ (200, 90)`, y también `  PC Ventas [PC-PT] @ (377, 382)`.
//
// El nombre va con `.+?` y no con `\S+`: en Packet Tracer los nombres con
// espacios son legales y comunes ("PC Ventas", "SW Piso 2"). Con `\S+` esa
// línea no matcheaba y el equipo desaparecía del panel —pero su línea de
// puerto, que sí matchea, se le colgaba al equipo ANTERIOR. O sea que el panel
// no solo escondía un equipo: le atribuía sus interfaces y sus IPs a otro.
// Medido contra PT 9.0, no supuesto.
const EXPORT_DEVICE = /^ {2}(.+?) \[([^\]]+)\] @ \((-?\d+), (-?\d+)\)$/
const EXPORT_PORT = /^ {4}(.+?)(?: IP=(\S+))?( \[linked\])?$/
const EXPORT_WIRED = /^ {2}(.+?):(.+?) {2}<--> {2}(.+?):(.+)$/
const EXPORT_WIRELESS = /^ {2}(.+?):(.+?) {2}\)\)\)/

// `  R1                   [2911]  (Vlan1,Gi0/0=10.0.0.1/255.255.255.252,Gi0/1)`
const QUERY_DEVICE = /^\s{2,}(.+?)\s+\[([^\]]+)\]\s+\((.*)\)\s*$/

/**
 * Pseudo-equipo que Packet Tracer se agrega solo a cada topología.
 *
 * No es parte de la red y vive fuera del lienzo útil —(3899, 3900) contra los
 * 100-700 de un lab—, así que incluirlo aplastaba el plano entero contra una
 * esquina: el span pasa a ser 3900 y los equipos reales caen todos en la misma
 * columna. Además ensucia el censo con un "OTROS: 1" que nadie puso.
 *
 * Antes quedaba afuera de casualidad, porque su nombre tiene espacios y el
 * regex pedía `\S+`. Ahora que los nombres con espacios se aceptan, hay que
 * excluirlo a propósito.
 */
const PT_INTERNO = /^Power Distribution Device/

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
        // El pseudo-equipo de PT corta la racha igual que uno real: sus puertos
        // no son de nadie, y menos del equipo de arriba.
        current = PT_INTERNO.test(dev[1]!)
          ? undefined
          : { name: dev[1]!, model: dev[2]!, x: Number(dev[3]), y: Number(dev[4]), ports: [] }
        if (current) devices.push(current)
        continue
      }
      const port = current && EXPORT_PORT.exec(line)
      if (port) {
        const p: Port = { name: port[1]!.trim(), linked: Boolean(port[3]) }
        if (port[2]) p.ip = port[2]
        current!.ports.push(p)
        continue
      }
      // Una línea a dos espacios es un equipo. Si llegó acá es que no se pudo
      // leer, y entonces el equipo en curso YA NO ES el dueño de los puertos que
      // vengan: sin este corte, los puertos del equipo ilegible se le suman al
      // anterior y el panel muestra IPs ajenas como si fueran suyas.
      if (/^ {2}\S/.test(line)) current = undefined
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
    if (!m || PT_INTERNO.test(m[1]!)) continue

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
  const text = unwrapToolOutput(output)

  // Construcción incremental. El agente arma una topología con decenas de
  // pt_add_device / pt_add_link, y si solo se escucharan las tools de lectura
  // el panel se quedaría congelado durante todo el build —que es justo cuando
  // hay algo interesante que mirar— y además borrar equipos no se reflejaría.
  if (/pt_add_link/.test(toolName)) {
    // El nombre del equipo llega hasta el PRIMER '/': un \S+ codicioso se come
    // medio nombre de puerto (R1/GigabitEthernet0 en vez de R1). El espacio SÍ
    // se admite dentro del nombre —"PC Ventas" es un nombre legal en PT— y por
    // eso la clase excluye solo la barra.
    const m = /Link created: ([^/]+)\/(\S+) <--\[[^\]]*\]--> ([^/]+)\/(\S+)/.exec(text)
    if (!m) return current
    return {
      devices: current.devices,
      links: [...current.links, {
        a: { device: m[1]!, port: m[2]! },
        b: { device: m[3]!, port: m[4]! },
        wireless: false,
      }],
    }
  }

  // Se borra POR PUERTO, que es como lo identifica PT: `pt_delete_link` recibe
  // un equipo y una interfaz, no los dos extremos. Sin esto el enlace seguía
  // dibujado y contado después de que PT ya lo había cortado — un cable
  // fantasma es peor que ninguno, porque el árbol lo usa para colgar equipos.
  if (/pt_delete_link/.test(toolName)) {
    const m = /Link on ([^/]+)\/(\S+) deleted/.exec(text)
    if (!m) return current
    const [, device, port] = m
    const toca = (e?: { device: string; port: string }) =>
      e !== undefined && e.device === device && e.port === port
    return {
      devices: current.devices,
      links: current.links.filter((l) => !toca(l.a) && !toca(l.b)),
    }
  }

  // Mover un equipo no cambia la red pero SÍ la disposición, y la disposición
  // es exactamente lo que el plano existe para mostrar: sin esto, pedir "corré
  // el core a la derecha" no redibujaba nada, porque `layoutKey` seguía viendo
  // las coordenadas viejas.
  if (/pt_move_device/.test(toolName)) {
    const m = /Device '(.+?)' moved to \((-?\d+), (-?\d+)\)/.exec(text)
    if (!m) return current
    return {
      devices: current.devices.map((d) =>
        d.name === m[1] ? { ...d, x: Number(m[2]), y: Number(m[3]) } : d),
      links: current.links,
    }
  }

  // El nombre es la clave con la que los enlaces referencian a los equipos, así
  // que renombrar sin arrastrar los enlaces deja el árbol colgando de un nombre
  // que ya no existe.
  if (/pt_rename_device/.test(toolName)) {
    // El separador va como "lo que sea que no es comilla": el MCP manda una
    // flecha Unicode y no vale la pena que el panel dependa de que ese carácter
    // sobreviva intacto el viaje por JSON y por el terminal.
    const m = /Device renamed: '(.+?)' [^']*'(.+?)'/.exec(text)
    if (!m) return current
    const [, viejo, nuevo] = m
    const mover = <T extends { device: string; port: string }>(e: T): T =>
      e.device === viejo ? { ...e, device: nuevo! } : e
    return {
      devices: current.devices.map((d) => (d.name === viejo ? { ...d, name: nuevo! } : d)),
      links: current.links.map((l) => ({
        ...l,
        a: mover(l.a),
        ...(l.b ? { b: mover(l.b) } : {}),
      })),
    }
  }

  if (/pt_delete_device/.test(toolName)) {
    const m = /Device '(.+?)' deleted/.exec(text)
    if (!m) return current
    const gone = m[1]!
    return {
      devices: current.devices.filter((d) => d.name !== gone),
      links: current.links.filter((l) => l.a.device !== gone && l.b?.device !== gone),
    }
  }

  if (/pt_add_device/.test(toolName)) {
    const m = /Device '(.+?)' \((.+?)\) created at \((-?\d+), (-?\d+)\)/.exec(text)
    if (!m) return current
    return {
      devices: [...current.devices, {
        name: m[1]!, model: m[2]!, x: Number(m[3]), y: Number(m[4]), ports: [],
      }],
      links: current.links,
    }
  }

  if (!/pt_(full_build|export_topology|query_topology)/.test(toolName)) return current

  const next = parseFullBuild(text) ?? parseExportTopology(text) ?? parseQueryTopology(text)
  if (!next) return current

  // query_topology no trae enlaces: si ya teníamos, se conservan.
  if (!next.links.length && current.links.length) {
    return { devices: next.devices, links: current.links }
  }
  return next
}

export { EMPTY }
