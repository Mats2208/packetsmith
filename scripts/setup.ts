// Deja PacketSmith listo para usar. `bun run setup`.
//
// Son cuatro piezas y ninguna es obvia: el CLI de Claude, el servidor MCP
// —que no está en PyPI, así que se instala del repo—, su registro en la config
// del CLI, y la extensión de Packet Tracer.
//
// Regla de la casa: NADA se instala sin preguntar. Este script crea un venv,
// baja código de internet y toca la configuración del CLI del usuario. Cada
// una de esas tres cosas se anuncia y se confirma antes de hacerse, y se puede
// correr con `--dry-run` para ver el plan sin ejecutar nada.
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isConfigured } from "../src/engine/mcp.ts"
import { rgb } from "../src/tui/contrast.ts"
import { DEFAULT_THEME, findTheme } from "../src/tui/themes.ts"

const REPO = "https://github.com/Mats2208/MCP-Packet-Tracer"
const HOME = homedir()
const DEST = join(HOME, ".packetsmith")
const VENV = join(DEST, "mcp-venv")
const PTS = join(DEST, "MCP-Control-Center.pts")

const DRY = process.argv.includes("--dry-run")
const YES = process.argv.includes("--yes")

/**
 * Los colores, derivados del tema por defecto en vez de copiados a mano.
 *
 * Antes había acá una segunda paleta escrita como escapes ANSI crudos
 * (`\x1b[38;2;234;234;234m`), que es lo mismo que `C.fg` dicho de otra forma.
 * Dos copias del mismo dato se despegan sola la primera vez que alguien toca
 * una: el instalador seguiría pintando con los colores de la versión anterior y
 * nadie se enteraría.
 *
 * Esto es ANSI y no OpenTUI porque el instalador escribe a una terminal común,
 * sin renderer: acá no hay dónde poner un `<text>`.
 */
const ansi = (hex: string) => (s: string) => {
  const [r, g, b] = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
}

const P = findTheme(DEFAULT_THEME)!.colors
const c = {
  t: ansi(P.fg),
  d: ansi(P.dim),
  b: ansi(P.brand),
  ok: ansi(P.live),
  no: ansi(P.alert),
  w: ansi(P.warn),
}

/** Corre un comando y devuelve si salió bien. En dry-run solo lo imprime. */
async function run(cmd: string[], label: string): Promise<boolean> {
  console.log(c.d(`  $ ${cmd.join(" ")}`))
  if (DRY) return true
  const p = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" })
  const code = await p.exited
  if (code !== 0) console.log(c.no(`  ✗ falló: ${label}`))
  return code === 0
}

/**
 * Si un ejecutable está en el PATH.
 *
 * `Bun.which` y no `which`: ese binario no existe en Windows —el equivalente es
 * `where`— así que el script se moría en la primera comprobación con
 * "Executable not found in $PATH: which", antes de imprimir una sola línea
 * útil. Windows es justo donde más corre Packet Tracer.
 */
function has(bin: string): boolean {
  return Bun.which(bin) !== null
}

const WIN = process.platform === "win32"

/** El intérprete de Python que exista en esta máquina. */
const PYTHON = ["python3", "python"].find(has)

/** Dentro de un venv, los ejecutables viven en `Scripts` en Windows y en `bin` en el resto. */
const venvBin = (name: string) => join(VENV, WIN ? "Scripts" : "bin", name)

/**
 * Pregunta antes de tocar nada.
 *
 * Un instalador que crea entornos, baja código y edita la configuración de otro
 * programa sin avisar es exactamente lo que uno no quiere correr.
 */
async function confirm(question: string): Promise<boolean> {
  if (YES || DRY) return true
  process.stdout.write(`${c.t(question)} ${c.d("[s/N]")} `)
  const line = await new Promise<string>((res) => {
    process.stdin.once("data", (d) => res(String(d)))
  })
  return /^s(i|í)?$/i.test(line.trim())
}

console.log(`\n${c.b("PACKETSMITH")} ${c.d("· setup")}${DRY ? c.d("  (dry-run)") : ""}\n`)

// ── 1. Lo que tiene que estar de antes ──────────────────────────────────────
let falta = false
for (const [bin, why, presente] of [
  ["bun", "corre la app — OpenTUI no anda en Node", has("bun")],
  ["claude", "es el agente que PacketSmith envuelve", has("claude")],
  // Se informa cuál se encontró: en Windows suele ser `python` y en Linux
  // `python3`, y decir "python3 ○" cuando hay un Python perfecto instalado
  // manda a instalar algo que ya está.
  [PYTHON ?? "python3", "corre el servidor MCP", Boolean(PYTHON)],
  ["git", "baja el servidor MCP", has("git")],
] as const) {
  console.log(`  ${presente ? c.ok("●") : c.no("○")} ${c.t(bin.padEnd(9))}${c.d(why)}`)
  if (!presente) falta = true
}
if (falta) {
  console.log(`\n${c.no("Falta alguna herramienta de arriba.")} Instalala y volvé a correr esto.\n`)
  process.exit(1)
}

// ── 2. El servidor MCP ──────────────────────────────────────────────────────
console.log()
if (isConfigured(HOME, process.cwd())) {
  console.log(`  ${c.ok("●")} ${c.t("el MCP ya está registrado en el CLI")} ${c.d("— nada que hacer")}`)
} else {
  console.log(c.t("El MCP de Packet Tracer no está registrado. Para dejarlo listo hace falta:"))
  console.log(c.d(`    · clonar ${REPO}`))
  console.log(c.d(`      en ${DEST}`))
  console.log(c.d(`    · crear un entorno de Python ahí e instalarlo`))
  console.log(c.d(`    · registrarlo en tu config del CLI (claude mcp add, scope usuario)`))
  console.log()

  if (!(await confirm("¿Lo hago?"))) {
    console.log(c.d("\n  Ok, no toco nada. El comando manual está en el README.\n"))
    process.exit(0)
  }

  if (!DRY) mkdirSync(DEST, { recursive: true })
  const src = join(DEST, "MCP-Packet-Tracer")

  if (!existsSync(src) && !(await run(["git", "clone", "--depth", "1", REPO, src], "clone"))) {
    process.exit(1)
  }
  if (!existsSync(VENV) && !(await run([PYTHON!, "-m", "venv", VENV], "venv"))) process.exit(1)

  const pip = venvBin("pip")
  const py = venvBin("python")
  // `mcp<2` porque `mcp.server.fastmcp` desapareció en la 2.0 y el servidor no
  // arranca. Va explícito y no confiado al pyproject: si alguna vez se afloja
  // ahí, esto sigue instalando una versión que funciona.
  if (!(await run([pip, "install", "-q", "mcp<2"], "mcp<2"))) process.exit(1)
  if (!(await run([pip, "install", "-q", "-e", src], "packet-tracer-mcp"))) process.exit(1)

  const ok = await run(
    ["claude", "mcp", "add", "packet-tracer", "--scope", "user",
      "--", py, "-m", "packet_tracer_mcp", "--stdio"],
    "claude mcp add",
  )
  if (!ok) process.exit(1)
  console.log(`  ${c.ok("●")} ${c.t("MCP instalado y registrado")}`)
}

// ── 3. La extensión de Packet Tracer ────────────────────────────────────────
//
// Se puede BAJAR sola, pero cargarla no: Packet Tracer solo la acepta por su
// menú. Lo honesto es dejarla a mano y decir los tres clics exactos, en vez de
// mandar a buscar un release.
console.log()
if (existsSync(PTS)) {
  console.log(`  ${c.ok("●")} ${c.t("extensión ya descargada")}`)
} else if (await confirm("¿Bajo la extensión de Packet Tracer (.pts)?")) {
  if (!DRY) mkdirSync(DEST, { recursive: true })
  const rel = await fetch("https://api.github.com/repos/Mats2208/MCP-Packet-Tracer/releases/latest")
    .then((r) => r.json())
    .catch(() => null)
  const asset = rel?.assets?.find((a: any) => String(a.name).endsWith(".pts"))

  if (!asset) {
    console.log(c.w(`  ⚠ no encontré el .pts en los releases — bajalo de ${REPO}/releases`))
  } else if (DRY) {
    console.log(c.d(`  ↓ ${asset.name} → ${PTS}`))
  } else {
    await Bun.write(PTS, await fetch(asset.browser_download_url).then((r) => r.arrayBuffer()))
    console.log(`  ${c.ok("●")} ${c.t(asset.name)} ${c.d("→")} ${c.d(PTS)}`)
  }
}

console.log(`
${c.t("Último paso, y este va a mano porque Packet Tracer no acepta otra cosa:")}

  ${c.b("1.")} Packet Tracer ${c.d("▸")} Extensions ${c.d("▸")} Scripting ${c.d("▸")} Configure PT Script Modules
  ${c.b("2.")} Add… ${c.d("y elegí")} ${c.d(PTS)}
  ${c.b("3.")} Extensions ${c.d("▸")} MCP BUILDER ${c.d("— se conecta solo")}

${c.d("Después:")} ${c.t("bun run src/index.tsx")}
`)
