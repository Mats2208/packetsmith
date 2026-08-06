// Acotar el agente al MCP que esta app necesita.
//
// Por defecto el CLI hereda TODA la configuración MCP del usuario. En una
// máquina con varios servidores eso son ciento y pico de tools —Blender, Gmail,
// Drive, un navegador— y sus definiciones viajan en CADA pedido: prompt más
// grande, más caché que crear, más tiempo hasta el primer token, y más plata.
//
// PacketSmith es una app de Packet Tracer. Con `--strict-mcp-config` y un
// archivo que solo declara ese servidor, el agente arranca con lo que usa y
// nada más.
//
// Regla que no se negocia: si no se encuentra la configuración del servidor,
// NO se pasa `--strict-mcp-config`. Pasarlo sin haber encontrado nada dejaría
// al agente sin ninguna tool pt_*, que es peor que arrancar lento.
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** El nombre con el que el MCP de Packet Tracer figura en la config. */
const SERVER = "packet-tracer"

/**
 * Busca la definición del servidor en la config del CLI.
 *
 * Se mira el scope de usuario y el del proyecto, en ese orden, porque es el
 * mismo orden en el que el CLI las resuelve.
 */
export function findServer(config: unknown, cwd: string): unknown {
  if (typeof config !== "object" || config === null) return undefined
  const c = config as Record<string, any>
  return c.projects?.[cwd]?.mcpServers?.[SERVER] ?? c.mcpServers?.[SERVER]
}

/**
 * Si el MCP de Packet Tracer está registrado en el CLI.
 *
 * Es la dependencia que la app NO puede resolver sola: sin ese servidor el
 * agente arranca igual y contesta igual, pero sin una sola tool `pt_*`, o sea
 * sin poder tocar Packet Tracer. Falla de la peor manera posible —parece que
 * funciona— así que conviene decirlo antes de que escriba el primer mensaje.
 */
export function isConfigured(home: string, cwd: string): boolean {
  try {
    return Boolean(findServer(JSON.parse(readFileSync(`${home}/.claude.json`, "utf8")), cwd))
  } catch {
    return false
  }
}

/**
 * Deja escrito un archivo con solo el servidor de Packet Tracer y devuelve los
 * flags para usarlo. Vacío si no se encontró: se falla ABIERTO.
 */
export function scopeToPacketTracer(
  home: string,
  cwd: string,
  pid = process.pid,
): { args: string[]; path?: string } {
  if (process.env.PACKETSMITH_ALL_MCP) return { args: [] }

  let server: unknown
  try {
    // Síncrono a propósito: son unos kilobytes una sola vez, al arrancar, y
    // hacerlo async obligaría a volver `Engine.start` asíncrono para todos los
    // motores por una lectura que tarda menos que el spawn que viene después.
    server = findServer(JSON.parse(readFileSync(`${home}/.claude.json`, "utf8")), cwd)
  } catch {
    return { args: [] }
  }
  if (!server) return { args: [] }

  const path = join(tmpdir(), `packetsmith-mcp-${pid}.json`)
  // 0600 explícito. Lo que se copia acá sale de `~/.claude.json`, que es del
  // usuario y nada más, y una definición de servidor MCP puede traer un bloque
  // `env` con credenciales. Sin el modo, `writeFileSync` deja 0644 y el archivo
  // queda legible por cualquiera en un /tmp compartido: sería bajarle los
  // permisos a un secreto por el camino.
  writeFileSync(path, JSON.stringify({ mcpServers: { [SERVER]: server } }), { mode: 0o600 })
  return { args: ["--mcp-config", path, "--strict-mcp-config"], path }
}
