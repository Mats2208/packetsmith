#!/usr/bin/env bun
// Compila binarios que corren SIN Bun instalado.
//
// El punto no es publicar en npm —npm acepta cualquier cosa— sino que arranque
// en una máquina que no tiene Bun. Un paquete de fuentes `.tsx` necesita Bun
// para ejecutarse; un binario compilado se lleva el runtime adentro.
//
// La trampa que cuesta encontrar: en desarrollo el JSX de Solid lo transforma
// un PRELOAD que declara `bunfig.toml`, y al compilar los preloads no corren.
// Sin el plugin de abajo, el binario se construye perfecto y revienta al primer
// <box> con "Orphan text error" — o sea, falla al dibujar, no al compilar, y
// por eso `--help` parece andar. Comprobado.
//
// Uso:
//   bun run build            → los siete objetivos
//   bun run build --local    → solo esta plataforma, para probar rápido
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import pkg from "../package.json" with { type: "json" }

const DIST = "dist"
const solo = process.argv.includes("--local")

/**
 * Dónde tiene que correr.
 *
 * Linux lleva la variante musl porque Alpine —y los contenedores que la usan—
 * no tienen glibc, y un binario glibc ahí no arranca con un error que no dice
 * nada útil.
 */
const OBJETIVOS = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
] as const

const elegidos = solo
  ? OBJETIVOS.filter((o) => o.os === process.platform && o.arch === process.arch && !o.abi)
  : OBJETIVOS

if (!elegidos.length) {
  console.error(`no hay objetivo para ${process.platform}/${process.arch}`)
  process.exit(1)
}

// OpenTUI dibuja con una librería NATIVA, una por plataforma, y `bun install`
// solo bajó la de esta máquina. Compilando para otra, el bundle no la encuentra
// y falla con "Could not resolve @opentui/core-linux-x64". Hay que pedirlas
// todas explícitamente.
if (!solo && !process.argv.includes("--skip-install")) {
  console.log("bajando los nativos de OpenTUI para todas las plataformas…")
  // Comillas obligatorias: el shell de Bun expande `*` como glob y falla con
  // "no matches found".
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`.quiet()
}

await rm(DIST, { recursive: true, force: true })
const plugin = createSolidTransformPlugin()

for (const o of elegidos) {
  const nombre = [o.os === "win32" ? "windows" : o.os, o.arch, o.abi].filter(Boolean).join("-")
  const target = `bun-${nombre}` as Bun.Build.CompileTarget
  const exe = `packetsmith${o.os === "win32" ? ".exe" : ""}`
  const carpeta = `${DIST}/packetsmith-${nombre}`

  const r = await Bun.build({
    entrypoints: ["./src/index.tsx"],
    tsconfig: "./tsconfig.json",
    // Sin esto el binario compila igual y se rompe al primer <box>.
    plugins: [plugin],
    minify: true,
    compile: { target, outfile: `${carpeta}/bin/${exe}` },
  })
  if (!r.success) {
    for (const log of r.logs) console.error(log)
    process.exit(1)
  }

  // Un paquete npm por plataforma. `os` y `cpu` hacen que npm baje SOLO el que
  // corresponde: sin eso, instalar traería los siete y unos 700 MB.
  await Bun.write(`${carpeta}/package.json`, JSON.stringify({
    name: `packetsmith-${nombre}`,
    version: pkg.version,
    description: `${pkg.description} — binario para ${nombre}.`,
    license: pkg.license,
    repository: pkg.repository,
    os: [o.os],
    cpu: [o.arch],
    ...(o.abi ? { libc: [o.abi] } : {}),
  }, null, 2) + "\n")

  const bytes = (await Bun.file(`${carpeta}/bin/${exe}`).arrayBuffer()).byteLength
  console.log(`${nombre.padEnd(20)} ${(bytes / 1024 / 1024).toFixed(0)} MB`)
}

// El paquete que instala la gente: no trae binario, trae un lanzador de Node y
// los siete como dependencias OPCIONALES. npm resuelve solo la que matchea
// `os`/`cpu` y descarta el resto sin fallar — que es exactamente para lo que
// existen las opcionales, y cómo lo hacen esbuild, swc y opencode.
if (!solo) {
  const carpeta = `${DIST}/packetsmith`
  await mkdir(`${carpeta}/bin`, { recursive: true })
  await $`cp scripts/launcher.cjs ${carpeta}/bin/packetsmith`
  await Bun.write(`${carpeta}/package.json`, JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    keywords: pkg.keywords,
    license: pkg.license,
    author: pkg.author,
    homepage: pkg.homepage,
    repository: pkg.repository,
    bugs: pkg.bugs,
    bin: { packetsmith: "./bin/packetsmith" },
    os: OBJETIVOS.map((o) => o.os).filter((v, i, a) => a.indexOf(v) === i),
    cpu: ["x64", "arm64"],
    optionalDependencies: Object.fromEntries(OBJETIVOS.map((o) => [
      `packetsmith-${[o.os === "win32" ? "windows" : o.os, o.arch, o.abi].filter(Boolean).join("-")}`,
      pkg.version,
    ])),
  }, null, 2) + "\n")
  await $`cp README.md LICENSE ${carpeta}/`
  console.log(`\n${carpeta}  ← el que se instala`)
}
