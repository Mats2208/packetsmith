#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { getEngine } from "./engine/index.ts"
import { App } from "./tui/app.tsx"

// PACKETSMITH_ENGINE existe para poder probar otro motor sin recompilar nada.
// Cuando haya más de uno, esto pasa a ser un flag de verdad.
const engine = getEngine(process.env.PACKETSMITH_ENGINE ?? "claude")

render(() => <App engine={engine} />)
