#!/usr/bin/env bun
/** @jsxImportSource @opentui/solid */
// La pragma de arriba parece redundante —`tsconfig.json` ya dice
// `jsxImportSource`— pero no lo es: instalado como paquete, Bun NO lee el
// tsconfig de adentro de `node_modules`, así que se cae buscando el runtime de
// React. Comprobado empaquetando e instalando de verdad. La pragma viaja con el
// archivo y funciona en los dos casos.
import { render } from "@opentui/solid"
import { engines, getEngine } from "./engine/index.ts"
import { PROVIDERS } from "./engine/providers/catalog.ts"
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

// `packetsmith setup` — el instalador, como subcomando.
//
// Existe por el binario compilado: quien instala con `npm i -g` o con el script
// de curl NO tiene el repo, así que `bun run setup` no es una opción para él y
// se quedaría sin forma de instalar el MCP. Import dinámico para que el
// instalador solo se cargue cuando se pide.
if (argv[0] === "setup") {
  await import("../scripts/setup.ts")
  process.exit(0)
}

if (argv.includes("--help") || argv.includes("-h")) {
  // En inglés como el resto de la documentación pública del proyecto. La
  // interfaz sí se traduce —eso es `/language`—, pero el `--help` lo lee quien
  // todavía no arrancó la app.
  const col = (s: string) => s.padEnd(20)
  // Los motores son ~150 —los seis curados más lo que trae models.dev— así que
  // listarlos todos acá llenaba la pantalla con una línea de dos mil caracteres.
  // Se nombran los curados y se dice cuántos más hay; el resto se elige con
  // `/engine`, que filtra mientras tipeás.
  const curados = ["claude", ...PROVIDERS.map((p) => p.id)]
  const otros = Object.keys(engines).length - curados.length
  console.log(`
packetsmith — describe a network in plain language, watch it build itself

  ${col("--engine <name>")}${curados.join(" · ")}
  ${col("")}+ ${otros} more from models.dev — see /engine
  ${col("")}                         (env PACKETSMITH_ENGINE)
  ${col("--model <name>")}whatever the engine offers — see /model
  ${col("")}                         (env PACKETSMITH_MODEL)
  ${col("--effort <level>")}${EFFORTS.join(" · ")}
  ${col("")}                         (env PACKETSMITH_EFFORT)
  ${col("--language <code>")}${LANGS.join(" · ")}                  (env PACKETSMITH_LANGUAGE)
  ${col("--theme <name>")}${THEMES.map((t) => t.name).join(" · ")}
  ${col("")}                         (env PACKETSMITH_THEME)
  ${col("--help")}this

  ${col("setup")}install the Packet Tracer MCP and the extension
  ${col("")}--dry-run to see the plan without touching anything

Inside, "/" on an empty prompt opens the command palette; Ctrl+P works anywhere.
Whatever you pick with /theme, /model, /effort and /language is remembered.
`)
  process.exit(0)
}

// Precedencia: flag, entorno, lo último que elegiste, el valor por defecto.
// Un flag explícito gana siempre — es lo que uno espera de un flag.
const cfg = loadConfig()

const engine = getEngine(flag("engine") ?? process.env.PACKETSMITH_ENGINE ?? cfg.engine ?? "claude")
// El modelo se busca POR MOTOR: los alias de Claude no existen en Kimi, así que
// arrastrar el último elegido entre motores pedía un modelo inexistente.
const model = flag("model") ?? process.env.PACKETSMITH_MODEL ?? cfg.models?.[engine.name]

const nivel = flag("effort") ?? process.env.PACKETSMITH_EFFORT ?? cfg.effort
const effort = (EFFORTS as readonly string[]).includes(nivel ?? "")
  ? (nivel as Effort)
  : undefined

const tema = flag("theme") ?? process.env.PACKETSMITH_THEME ?? cfg.theme
if (tema) setTheme(tema)

const lang = flag("language") ?? process.env.PACKETSMITH_LANGUAGE ?? cfg.language
if (lang) setIdioma(lang)

render(() => <App engine={engine} model={model} effort={effort} />)
