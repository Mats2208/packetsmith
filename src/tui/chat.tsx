// Panel izquierdo: la conversación. Presentación pura — quien corre el motor
// y arma los turnos es app.tsx.
import { For, Show } from "solid-js"
import type { Topology } from "../topology/model.ts"
import { drawMap, naturalWidth, type Ink } from "../topology/map.ts"
import { C } from "./theme.ts"
import { rule } from "./ascii.ts"
import { GUTTER } from "./frame.tsx"
import { Welcome } from "./welcome.tsx"

export interface Turn {
  role: "user" | "agent"
  text: string
  /** Tools que el agente usó en este turno, en orden. */
  tools?: { name: string; done: boolean; isError: boolean; id?: string; ms?: number }[]
  /**
   * A dónde se fue el tiempo del turno.
   *
   * Existe porque "esto va lento" no se puede contestar mirando: en una app que
   * habla con un modelo Y con Packet Tracer por HTTP, la espera puede estar en
   * cualquiera de los dos y la respuesta cambia por completo qué hay que hacer.
   */
  timing?: { totalMs: number; toolMs: number }
  /**
   * Topología a dibujar como plano bajo la respuesta.
   *
   * Solo va en los turnos que la CAMBIARON: repetir el mismo plano en cada
   * respuesta lo volvería papel tapiz y dejaría de mirarse.
   */
  map?: Topology
}

/**
 * Tono de cada tipo de celda del plano.
 *
 * Los cables van en `wire` y no en `rule`: un filete puede permitirse ser casi
 * invisible porque su trabajo es separar, pero un cable es DATO. Dibujados en
 * `rule` sobre el fondo casi-negro el plano se veía como nodos flotando sin
 * ninguna conexión entre ellos.
 */
const INK: Record<Ink, string> = {
  node: C.fg,
  link: C.wire,
  label: C.dim,
}

/**
 * El plano de la red, con las coordenadas reales del canvas de Packet Tracer.
 *
 * No compite con el árbol del panel: el árbol contesta de qué cuelga cada
 * equipo, el plano contesta cómo está armado. Un uplink que cruza de un extremo
 * al otro del lienzo se ve acá y es invisible en el árbol.
 */
function MapBlock(props: { topology: Topology; width: number }) {
  // El dibujo pide el ancho que necesita y acá se lo recorta a lo que haya. Al
  // revés —estirarlo a todo lo disponible— una red de diez equipos en una
  // terminal ancha quedaba desparramada media pantalla.
  const inner = () => Math.min(props.width - 2, naturalWidth(props.topology))

  // Debajo de este ancho el plano sale con nodos cortados, y un plano cortado
  // miente sobre la red. Mejor no dibujarlo.
  const rows = () =>
    inner() < 30 ? [] : drawMap(props.topology, { width: inner(), maxHeight: 15 })

  return (
    <Show when={rows().length}>
      {/* Enmarcado: el plano es una FIGURA, no más texto de la respuesta. Sin
          el marco, sus líneas se confundían con la prosa de arriba y no se
          sabía dónde empezaba ni dónde terminaba. */}
      <box
        style={{
          flexDirection: "column",
          width: inner() + 2,
          height: rows().length + 2,
          marginTop: 1,
          flexShrink: 0,
          border: true,
          borderColor: C.rule,
        }}
        title=" PLANO · CANVAS DE PT "
        titleAlignment="center"
      >
        <For each={rows()}>
          {(spans) => (
            <box style={{ flexDirection: "row", height: 1 }}>
              <For each={spans}>
                {(s) => <text style={{ fg: INK[s.ink] }}>{s.text}</text>}
              </For>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

/** `mcp__packet-tracer__pt_full_build` → `pt_full_build`. */
export function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "")
}

/**
 * Trocea el texto en las piezas que la UI sabe dibujar.
 *
 * Markdown SELECTIVO a propósito: pasar todo por un renderer borra el aire de
 * terminal, pero dejarlo crudo hace ilegible cualquier respuesta con CLI de
 * Cisco, tablas de verificación o encabezados — que es la mitad de lo que este
 * agente responde.
 */
export type Piece =
  | { kind: "code"; text: string }
  | { kind: "head"; text: string }
  | { kind: "rule" }
  | { kind: "row"; cells: string[] }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string }
  /** Renglón en blanco entre párrafos. */
  | { kind: "gap" }
  /**
   * Tabla entera, no fila por fila.
   *
   * Las columnas solo se pueden dimensionar viendo TODAS las filas juntas. Con
   * un ancho fijo por celda —lo que había— una verificación real quedaba
   * cortada a la mitad: "PC-NORTE-ADM → 10.1.10.10" salía como
   * "PC-NORTE-ADM → 10.1.", que es peor que no tener tabla porque parece un
   * dato y no lo es.
   */
  | { kind: "table"; rows: string[][] }

const FENCE = /```[^\n]*\n([\s\S]*?)```/g

/** Quita el marcado inline que no se puede pintar y deja el contenido. */
export function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
}

export function parseBlocks(text: string): Piece[] {
  const out: Piece[] = []
  let last = 0
  let m: RegExpExecArray | null

  /** Un solo hueco entre bloques, y nunca uno al principio. */
  const gap = () => {
    if (out.length && out[out.length - 1]!.kind !== "gap") out.push({ kind: "gap" })
  }

  const prose = (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd()
      // Los renglones en blanco del markdown se descartaban, así que dos
      // párrafos distintos quedaban pegados y la respuesta se leía como un
      // muro. El salto que puso el modelo es información: dice dónde termina
      // una idea. Se respeta.
      if (!line.trim()) { gap(); continue }

      // Separador de tabla: |---|---| no aporta nada en un panel angosto.
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) { out.push({ kind: "rule" }); continue }

      if (/^\s*\|.*\|\s*$/.test(line)) {
        out.push({
          kind: "row",
          cells: line.trim().slice(1, -1).split("|").map((c) => stripInline(c.trim())),
        })
        continue
      }
      // Un encabezado abre sección: siempre respira arriba, lo haya separado
      // el modelo con un renglón en blanco o no.
      if (/^#{1,6}\s+/.test(line)) {
        gap()
        out.push({ kind: "head", text: stripInline(line) })
        continue
      }
      if (/^\s*[-*]\s+/.test(line)) {
        out.push({ kind: "bullet", text: stripInline(line.replace(/^\s*[-*]\s+/, "")) })
        continue
      }
      out.push({ kind: "text", text: stripInline(line) })
    }
  }

  while ((m = FENCE.exec(text))) {
    if (m.index > last) prose(text.slice(last, m.index))
    out.push({ kind: "code", text: m[1]!.replace(/\n$/, "") })
    last = m.index + m[0].length
  }
  if (last < text.length) prose(text.slice(last))

  // Un hueco al final solo empuja el bloque siguiente sin separar nada.
  if (out[out.length - 1]?.kind === "gap") out.pop()
  return groupTables(out)
}

/**
 * Junta filas consecutivas en una tabla.
 *
 * El parser las emite de a una porque las lee de a una, pero dibujarlas de a
 * una obliga a un ancho de columna fijo, y ahí es donde se cortaban los datos.
 * El separador `|---|` desaparece: en un panel de terminal no separa nada que
 * la alineación no separe ya.
 */
function groupTables(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  let rows: string[][] | undefined

  const close = () => {
    if (rows) out.push({ kind: "table", rows })
    rows = undefined
  }

  for (const p of pieces) {
    if (p.kind === "row") {
      ;(rows ??= []).push(p.cells)
      continue
    }
    // La regla vive DENTRO de la tabla, así que no la corta.
    if (p.kind === "rule" && rows) continue
    close()
    out.push(p)
  }
  close()
  return out
}

/**
 * Ancho de cada columna: el del contenido más largo.
 *
 * Si la suma no entra en el ancho disponible, se recorta la columna más ancha
 * —y solo esa— hasta que entre. Repartir el recorte entre todas mutila las
 * columnas cortas, que suelen ser justo las que traen el dato duro (`4/4`,
 * `OK`, una IP).
 */
export function columnWidths(rows: string[][], available: number): number[] {
  const cols = Math.max(...rows.map((r) => r.length))
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)))

  const GAP = 2
  let total = () => widths.reduce((a, b) => a + b, 0) + GAP * (cols - 1)
  while (total() > available) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest]! <= 6) break
    widths[widest]!--
  }
  return widths
}

/**
 * Una tabla, con las columnas dimensionadas por su contenido.
 *
 * La primera fila es el encabezado y se dibuja encendida con un filete debajo:
 * en una respuesta larga, una tabla sin cabeza marcada se confunde con prosa
 * tabulada.
 */
function Table(props: { rows: string[][]; width?: number }) {
  const widths = () => columnWidths(props.rows, (props.width ?? 76) - 2)
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => c.padEnd(widths()[i] ?? 0).slice(0, widths()[i] ?? 0)).join("  ")

  return (
    <>
      <text style={{ fg: C.fg }}>{line(props.rows[0] ?? [])}</text>
      <text style={{ fg: C.rule }}>
        {"  " + "─".repeat(widths().reduce((a, b) => a + b, 0) + 2 * (widths().length - 1))}
      </text>
      <For each={props.rows.slice(1)}>
        {(r) => <text style={{ fg: C.dim }}>{line(r)}</text>}
      </For>
    </>
  )
}

/**
 * Resume las tools de un turno en una línea.
 *
 * Un deploy real dispara 20+ llamadas y listarlas una por una tapaba la
 * respuesta del agente —que es lo que el usuario vino a leer— con una columna
 * de checks repetidos. Se colapsan las repetidas (`pt_verify_connectivity ×5`)
 * y los errores se muestran aparte, porque esos sí hay que verlos.
 */
export function summarizeTools(tools: NonNullable<Turn["tools"]>): {
  ok: string[]
  failed: string[]
  running: string[]
} {
  const tally = (list: typeof tools) => {
    const counts = new Map<string, { n: number; ms: number }>()
    for (const t of list) {
      const name = shortToolName(t.name)
      const acc = counts.get(name) ?? { n: 0, ms: 0 }
      counts.set(name, { n: acc.n + 1, ms: acc.ms + (t.ms ?? 0) })
    }
    return [...counts].map(([name, { n, ms }]) => {
      const veces = n > 1 ? ` ×${n}` : ""
      // El tiempo va SOLO si es notorio. Una tool de 200 ms no explica nada y
      // ponerle número a cada una convierte la fila de badges en un log.
      const tiempo = ms >= 1500 ? `  ${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : ""
      return `${name}${veces}${tiempo}`
    })
  }

  return {
    ok: tally(tools.filter((t) => t.done && !t.isError)),
    failed: tally(tools.filter((t) => t.done && t.isError)),
    running: tally(tools.filter((t) => !t.done)),
  }
}

/**
 * Una línea que dice a dónde se fue el tiempo del turno.
 *
 * El reparto entre "esperando a Packet Tracer" y "el modelo pensando" es la
 * única forma de contestar "¿por qué tarda?" sin adivinar, y cambia por
 * completo qué conviene hacer: si manda el bridge, hay que pedir menos vueltas;
 * si manda el modelo, no hay nada que optimizar de este lado.
 */
export function timingLine(t: NonNullable<Turn["timing"]>): string {
  const seg = (ms: number) =>
    ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`

  // El desglose recién vale la pena cuando la espera se sintió. En un turno de
  // ocho segundos repartir entre bridge y modelo es ruido; el total, en cambio,
  // va SIEMPRE: es un parámetro más del turno y queda ahí para consultarlo
  // después, que es justo lo que no se podía hacer con el reloj de la barra.
  if (t.totalMs < 20_000) return `⏱ ${seg(t.totalMs)}`

  const pct = Math.round((t.toolMs / t.totalMs) * 100)
  return `⏱ ${seg(t.totalMs)}  ·  ${seg(t.toolMs)} en packet tracer (${pct}%)  ·  ${seg(Math.max(0, t.totalMs - t.toolMs))} en el modelo`
}

/**
 * Las tools del turno, como badges.
 *
 * Se probó antes una escalera de `├ └`, una tool por renglón: un deploy real
 * dispara veinte llamadas y se comía la pantalla entera antes de que empezara
 * la respuesta. Los badges entran cuatro o cinco por renglón, y el fondo
 * hundido los separa de la prosa sin gastar un conector por línea.
 *
 * El orden no es el de llamada sino el de urgencia —corriendo, falladas,
 * hechas—: mientras mirás, lo que importa es qué está pasando y qué se rompió.
 */
function Tools(props: { tools: NonNullable<Turn["tools"]> }) {
  const badges = () => {
    const s = summarizeTools(props.tools)
    return [
      ...s.running.map((name) => ({ name, mark: "▶ ", fg: C.fg })),
      ...s.failed.map((name) => ({ name, mark: "✗ ", fg: C.alert })),
      ...s.ok.map((name) => ({ name, mark: "", fg: C.dim })),
    ]
  }

  return (
    <box style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 1 }}>
      <For each={badges()}>
        {(b) => (
          <box
            style={{
              backgroundColor: C.sunken,
              paddingLeft: 1,
              paddingRight: 1,
              marginRight: 1,
              height: 1,
              flexShrink: 0,
            }}
          >
            <text style={{ fg: b.fg }}>{`${b.mark}${b.name}`}</text>
          </box>
        )}
      </For>
    </box>
  )
}

/** Cada pieza con su tratamiento. La jerarquía la hace el color, no el tamaño:
 *  en un terminal todas las letras miden lo mismo. */
function Body(props: { text: string; width?: number }) {
  return (
    <For each={parseBlocks(props.text)}>
      {(p) => {
        switch (p.kind) {
          case "code":
            return (
              <box style={{ backgroundColor: C.sunken, paddingLeft: 1, marginTop: 1, marginBottom: 1 }}>
                <text style={{ fg: C.fg }}>{p.text}</text>
              </box>
            )
          case "gap":
            return <box style={{ height: 1 }} />
          case "head":
            return <text style={{ fg: C.fg }}>{`── ${p.text.toUpperCase()}`}</text>
          case "rule":
            return <text style={{ fg: C.rule }}>{"  " + "─".repeat(28)}</text>
          case "table":
            return <Table rows={p.rows} width={props.width} />
          case "row":
            return <text style={{ fg: C.dim }}>{"  " + p.cells.join("  ")}</text>
          case "bullet":
            return <text style={{ fg: C.dim }}>{`  · ${p.text}`}</text>
          default:
            return <text>{p.text}</text>
        }
      }}
    </For>
  )
}

/**
 * Un bloque de mensaje con su canaleta.
 *
 * La canaleta —una barra `▌` que corre por todo el alto del bloque— reemplaza
 * al par de etiquetas sueltas: dice de quién es el mensaje en cada línea, no
 * solo en la primera, que es justo lo que hacía falta cuando una respuesta pasa
 * de una pantalla y el encabezado ya se fue para arriba.
 */
function Block(props: { role: Turn["role"]; children: any }) {
  const mine = () => props.role === "user"
  return (
    <box
      style={{
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 1,
        border: ["left"],
        customBorderChars: GUTTER,
        borderColor: mine() ? C.fg : C.rule,
      }}
    >
      <text style={{ fg: mine() ? C.operator : C.dim }}>{mine() ? "VOS" : "AGENTE"}</text>
      {props.children}
    </box>
  )
}

export function Chat(props: {
  turns: Turn[]
  streaming: string
  busy: boolean
  /** Tools del turno EN CURSO: se ven mientras corren, no al terminar. */
  liveTools?: NonNullable<Turn["tools"]>
  /** Estado del puente con PT, para la pantalla de arranque. */
  live?: boolean
  /** Si el MCP de Packet Tracer está registrado en el CLI. */
  mcp?: boolean
  /** Ancho útil para el plano. Lo calcula quien sabe cuánto mide la terminal. */
  mapWidth?: number
}) {
  // La bienvenida REEMPLAZA la conversación, no la encabeza: así puede tomarse
  // el alto entero y centrarse, que es lo que la hace ver como una portada en
  // vez de un cartel pegado arriba a la izquierda.
  const vacio = () => !props.turns.length && !props.streaming && !props.liveTools?.length

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
      <Show when={vacio()}>
        <Welcome live={props.live} mcp={props.mcp} />
      </Show>

      <Show when={!vacio()}>
        {/* La barra de scroll se pinta siempre, haga falta o no, y sin teñirla
            queda una columna de bloques encendidos partiendo la conversación al
            medio. Con el fondo y el filete del tema se vuelve un riel. */}
        <scrollbox
          style={{ flexGrow: 1 }}
          verticalScrollbarOptions={{
            trackOptions: { backgroundColor: C.bg, foregroundColor: C.rule },
          }}
        >
          <For each={props.turns}>
            {(turn) => (
              <Block role={turn.role}>
                {/* Las tools van ANTES del texto: son lo que el agente hizo para
                    poder responder, y dejarlas después empujaba la respuesta
                    fuera de pantalla en cualquier deploy real. */}
                <Show when={turn.tools?.length}>
                  <Tools tools={turn.tools!} />
                </Show>
                <Show when={turn.timing}>
                  <text style={{ fg: C.rule }}>{timingLine(turn.timing!)}</text>
                  <box style={{ height: 1 }} />
                </Show>
                <Show when={turn.role === "agent"} fallback={<text>{turn.text}</text>}>
                  <Body text={turn.text} width={props.mapWidth} />
                </Show>
                <Show when={turn.map}>
                  <MapBlock topology={turn.map!} width={props.mapWidth ?? 76} />
                </Show>
              </Block>
            )}
          </For>

          {/* El turno en curso se pinta aparte: todavía no está cerrado. */}
          <Show when={props.streaming || props.liveTools?.length}>
            <Block role="agent">
              <Show when={props.liveTools?.length}>
                <Tools tools={props.liveTools!} />
              </Show>
              <Show when={props.streaming}>
                <text>{props.streaming}</text>
              </Show>
            </Block>
          </Show>
        </scrollbox>
      </Show>
    </box>
  )
}
