#!/usr/bin/env bun
// Punto de entrada. Por ahora solo reporta la versión: el TUI se monta acá
// cuando el motor emita eventos (ver AGENTS.md, "Orden de trabajo").
import pkg from "../package.json" with { type: "json" }

console.log(`packetsmith ${pkg.version}`)
