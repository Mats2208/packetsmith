#!/usr/bin/env node
// El `packetsmith` que queda en el PATH cuando se instala desde npm.
//
// Es CommonJS y de Node a propósito: es lo único que se puede dar por sentado
// en la máquina de quien hace `npm i -g packetsmith`. El binario de verdad lo
// trae la dependencia opcional que matchee su plataforma, y esto solo lo
// encuentra y lo ejecuta.
//
// Reenvía las señales porque si no, Ctrl+C mata al lanzador y deja al binario
// —y al servidor MCP que él levantó— corriendo huérfanos.

const { spawn } = require("node:child_process")
const { existsSync } = require("node:fs")

const SEÑALES = ["SIGINT", "SIGTERM", "SIGHUP"]

function plataforma() {
  const so = process.platform === "win32" ? "windows" : process.platform
  const partes = [so, process.arch]
  // En Linux hay dos ABIs y no son intercambiables: un binario de glibc en
  // Alpine no arranca, y el error no dice por qué.
  if (process.platform === "linux" && esMusl()) partes.push("musl")
  return partes.join("-")
}

function esMusl() {
  try {
    // `process.report` lo dice sin ejecutar nada. Si no está disponible se
    // asume glibc, que es lo mayoritario.
    return (process.report?.getReport()?.header?.glibcVersionRuntime ?? "") === ""
  } catch {
    return false
  }
}

function buscar() {
  const nombre = `packetsmith-${plataforma()}`
  const exe = `packetsmith${process.platform === "win32" ? ".exe" : ""}`
  try {
    const ruta = require.resolve(`${nombre}/bin/${exe}`)
    if (existsSync(ruta)) return ruta
  } catch {
    /* cae abajo con un mensaje que se entiende */
  }
  return undefined
}

const binario = buscar()
if (!binario) {
  console.error(
    `packetsmith: no encontré el binario para ${plataforma()}.\n\n` +
    `Suele pasar cuando se instaló con --no-optional o con las dependencias\n` +
    `opcionales desactivadas. Probá:\n\n` +
    `  npm i -g packetsmith-${plataforma()}\n\n` +
    `Si tu plataforma no está en la lista, contalo en\n` +
    `https://github.com/Mats2208/packetsmith/issues`,
  )
  process.exit(1)
}

const hijo = spawn(binario, process.argv.slice(2), { stdio: "inherit" })

const reenvios = {}
for (const s of SEÑALES) {
  reenvios[s] = () => { try { hijo.kill(s) } catch { /* ya murió */ } }
  process.on(s, reenvios[s])
}

hijo.on("error", (e) => {
  console.error(e.message)
  process.exit(1)
})

hijo.on("exit", (codigo, señal) => {
  for (const s of SEÑALES) process.removeListener(s, reenvios[s])
  // Morir de la misma señal que el hijo, para que quien nos llamó vea la
  // verdad: un Ctrl+C tiene que verse como un Ctrl+C, no como salida 0.
  if (señal) return process.kill(process.pid, señal)
  process.exit(typeof codigo === "number" ? codigo : 0)
})
