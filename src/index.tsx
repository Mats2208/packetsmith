#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { getEngine } from "./engine/index.ts"
import { App } from "./tui/app.tsx"

// Flags mínimos, sin librería de args: son dos y no justifican una dependencia.
const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 ? argv[i + 1] : undefined
}

const engine = getEngine(flag("engine") ?? process.env.PACKETSMITH_ENGINE ?? "claude")
const model = flag("model") ?? process.env.PACKETSMITH_MODEL

render(() => <App engine={engine} model={model} />)
