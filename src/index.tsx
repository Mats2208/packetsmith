#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { getEngine } from "./engine/index.ts"
import { EFFORTS, type Effort } from "./engine/types.ts"
import { App } from "./tui/app.tsx"
import { loadConfig } from "./config.ts"
import { setTheme, THEMES } from "./tui/theme.ts"
import { LANGS, setIdioma } from "./tui/i18n.ts"

// Flags mínimos, sin librería de args: son cuatro y no justifican una
// dependencia. Se acepta `--x valor` y `--x=valor`, que es lo que la gente
// tipea sin pensar.
const argv = process.argv.slice(2)
const flag = (name: string) => {
  const pegado = argv.find((a) => a.startsWith(`--${name}=`))
  if (pegado) return pegado.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  const v = i !== -1 ? argv[i + 1] : undefined
  // `--model --theme x` no significa que el modelo se llame "--theme".
  return v?.startsWith("--") ? undefined : v
}

if (argv.includes("--help") || argv.includes("-h")) {
  // En inglés como el resto de la documentación pública del proyecto. La
  // interfaz sí se traduce —eso es `/language`—, pero el `--help` lo lee quien
  // todavía no arrancó la app.
  const col = (s: string) => s.padEnd(20)
  console.log(`
packetsmith — describe a network in plain language, watch it build itself

  ${col("--engine <name>")}agent CLI to wrap        (env PACKETSMITH_ENGINE)
  ${col("--model <name>")}opus · sonnet · haiku…   (env PACKETSMITH_MODEL)
  ${col("--effort <level>")}${EFFORTS.join(" · ")}
  ${col("")}                         (env PACKETSMITH_EFFORT)
  ${col("--language <code>")}${LANGS.join(" · ")}                  (env PACKETSMITH_LANGUAGE)
  ${col("--theme <name>")}${THEMES.map((t) => t.name).join(" · ")}
  ${col("")}                         (env PACKETSMITH_THEME)
  ${col("--help")}this

Inside, "/" on an empty prompt opens the command palette; Ctrl+P works anywhere.
Whatever you pick with /theme, /model, /effort and /language is remembered.
`)
  process.exit(0)
}

// Precedencia: flag, entorno, lo último que elegiste, el valor por defecto.
// Un flag explícito gana siempre — es lo que uno espera de un flag.
const cfg = loadConfig()

const engine = getEngine(flag("engine") ?? process.env.PACKETSMITH_ENGINE ?? "claude")
const model = flag("model") ?? process.env.PACKETSMITH_MODEL ?? cfg.model

const nivel = flag("effort") ?? process.env.PACKETSMITH_EFFORT ?? cfg.effort
const effort = (EFFORTS as readonly string[]).includes(nivel ?? "")
  ? (nivel as Effort)
  : undefined

const tema = flag("theme") ?? process.env.PACKETSMITH_THEME ?? cfg.theme
if (tema) setTheme(tema)

const lang = flag("language") ?? process.env.PACKETSMITH_LANGUAGE ?? cfg.language
if (lang) setIdioma(lang)

render(() => <App engine={engine} model={model} effort={effort} />)
