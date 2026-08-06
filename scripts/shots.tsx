// Capturas para el README, generadas desde el CÓDIGO. `bun run shots`.
//
// No son maquetas ni fotos de pantalla: se renderiza la interfaz de verdad a un
// buffer, se leen los tramos CON su color (`captureSpans`) y se vuelcan a HTML.
// La ventaja es que no envejecen: si mañana cambia un color o una fila, las
// imágenes del README se regeneran corriendo esto de nuevo.
import { testRender } from "@opentui/solid"
import { mkdirSync } from "node:fs"
import { App } from "../src/tui/app.tsx"
import type { AgentEvent, Engine } from "../src/engine/types.ts"
import { ESCENAS, PANEL } from "./scenes.ts"

const OUT = "docs/shots"

function fakeEngine(events: AgentEvent[]): Engine {
  return {
    name: "claude",
    start() {
      return {
        send: () => true,
        async *events() {
          for (const e of events) yield e
          await new Promise(() => {})
        },
        close() {},
      }
    },
  }
}

const hex = (c: { buffer: ArrayLike<number> }) =>
  `#${[0, 1, 2].map((i) => Math.round(c.buffer[i]!).toString(16).padStart(2, "0")).join("")}`

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * La ventana. Barra de título con el semáforo de macOS y la fuente monoespaciada
 * de sistema: el marco es lo que hace que se lea como una app y no como un
 * volcado de texto.
 */
function page(body: string): string {
  return `<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { background:#161616; padding:28px; display:inline-block }
  .win { border-radius:10px; overflow:hidden; box-shadow:0 18px 60px rgba(0,0,0,.6);
         border:1px solid #262626; background:#0A0A0A }
  .bar { height:30px; background:#171717; display:flex; align-items:center; padding:0 12px; gap:8px;
         border-bottom:1px solid #222 }
  .dot { width:11px; height:11px; border-radius:50% }
  .t { flex:1; text-align:center; font:11px/1 ui-monospace,"SF Mono",monospace; color:#666;
       letter-spacing:.06em; margin-right:57px }
  /* max-content y no un ancho en 'ch': los bloques y filetes los sirve una
     fuente de respaldo cuyo avance no es el 'ch' de la principal, así que la
     caja quedaba corta y recortaba la última columna. */
  pre { font:13px/1.28 ui-monospace,"SF Mono","JetBrains Mono",monospace;
        padding:10px 12px; white-space:pre; background:#0A0A0A;
        width:max-content; font-variant-ligatures:none }
</style>
<div class="win">
  <div class="bar">
    <div class="dot" style="background:#FF5F57"></div>
    <div class="dot" style="background:#FEBC2E"></div>
    <div class="dot" style="background:#28C840"></div>
    <div class="t">packetsmith</div>
  </div>
  <pre>${body}</pre>
</div>
<script>
  // La página se mide a sí misma y deja el tamaño en el DOM. El navegador
  // headless captura una ventana entera, así que sin esto la imagen sale con
  // un mar de fondo alrededor; el ancho de un carácter depende de la fuente y
  // no se puede calcular desde afuera.
  const r = document.querySelector(".win").getBoundingClientRect()
  document.body.dataset.shot = Math.ceil(r.width + 56) + "x" + Math.ceil(r.height + 56)
</script>`
}

mkdirSync(OUT, { recursive: true })

for (const [nombre, escena] of Object.entries(ESCENAS)) {
  const { cols, rows, eventos, quota } = escena
  const setup = await testRender(
    () => App({ engine: fakeEngine(eventos), model: "opus-5", columns: cols, quota }),
    { width: cols, height: rows },
  )
  // El App consume los eventos de forma asíncrona: sin la pausa se captura la
  // primera pintura, cuando todavía no llegó ninguno.
  await new Promise((r) => setTimeout(r, 120))
  await setup.renderOnce()

  const body = setup.captureSpans().lines
    .map((l) => l.spans
      .map((s) => `<span style="color:${hex(s.fg)};background:${hex(s.bg)}">${escape(s.text)}</span>`)
      .join(""))
    .join("\n")

  await Bun.write(`${OUT}/${nombre}.html`, page(body))
  console.log(`${OUT}/${nombre}.html   ${cols}×${rows}`)
}

console.log(`\npanel de referencia: ${PANEL}`)
process.exit(0)
