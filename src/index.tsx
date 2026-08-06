#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { getEngine } from "./engine/index.ts"
import { EFFORTS, type Effort } from "./engine/types.ts"
import { App } from "./tui/app.tsx"
import { loadConfig } from "./config.ts"
import { setTheme, THEMES } from "./tui/theme.ts"

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
  console.log(`
packetsmith — redes en Packet Tracer, dichas en castellano

  --engine <nombre>   motor de agente          (env PACKETSMITH_ENGINE)
  --model  <nombre>   opus · sonnet · haiku…   (env PACKETSMITH_MODEL)
  --effort <nivel>    ${EFFORTS.join(" · ")}   (env PACKETSMITH_EFFORT)
  --theme  <nombre>   ${THEMES.map((t) => t.name).join(" · ")}
                                               (env PACKETSMITH_THEME)
  --help              esto

Adentro, "/" abre la paleta de comandos y Ctrl+P también.
Lo que elijas con /theme, /model y /effort queda guardado.
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

render(() => <App engine={engine} model={model} effort={effort} />)
