// Panel izquierdo: la conversación. Presentación pura — quien corre el motor
// y arma los turnos es app.tsx.
import { For, Show } from "solid-js"
import { C } from "./theme.ts"

export interface Turn {
  role: "user" | "agent"
  text: string
  /** Tools que el agente usó en este turno, en orden. */
  tools?: { name: string; done: boolean; isError: boolean }[]
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

  const prose = (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd()
      if (!line.trim()) continue

      // Separador de tabla: |---|---| no aporta nada en un panel angosto.
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) { out.push({ kind: "rule" }); continue }

      if (/^\s*\|.*\|\s*$/.test(line)) {
        out.push({
          kind: "row",
          cells: line.trim().slice(1, -1).split("|").map((c) => stripInline(c.trim())),
        })
        continue
      }
      if (/^#{1,6}\s+/.test(line)) { out.push({ kind: "head", text: stripInline(line) }); continue }
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
  return out
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
    const counts = new Map<string, number>()
    for (const t of list) {
      const n = shortToolName(t.name)
      counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
  }

  return {
    ok: tally(tools.filter((t) => t.done && !t.isError)),
    failed: tally(tools.filter((t) => t.done && t.isError)),
    running: tally(tools.filter((t) => !t.done)),
  }
}

function Tools(props: { tools: NonNullable<Turn["tools"]> }) {
  const s = () => summarizeTools(props.tools)
  return (
    <>
      <Show when={s().running.length}>
        <text style={{ fg: C.fg }}>{`    ${s().running.join(", ")} …`}</text>
      </Show>
      <Show when={s().failed.length}>
        <text style={{ fg: C.alert }}>{`    ✗ ${s().failed.join(", ")}`}</text>
      </Show>
      <Show when={s().ok.length}>
        <text style={{ fg: C.dim }}>{`    ${s().ok.join(" · ")}`}</text>
      </Show>
    </>
  )
}

/** Cada pieza con su tratamiento. La jerarquía la hace el color, no el tamaño:
 *  en un terminal todas las letras miden lo mismo. */
function Body(props: { text: string }) {
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
          case "head":
            return <text style={{ fg: C.fg }}>{`\n── ${p.text.toUpperCase()}`}</text>
          case "rule":
            return <text style={{ fg: C.rule }}>{"  " + "─".repeat(28)}</text>
          case "row":
            // Columnas de ancho fijo: una tabla desalineada es peor que ninguna.
            return (
              <text style={{ fg: C.dim }}>
                {"  " + p.cells.map((c) => c.padEnd(16).slice(0, 16)).join(" ")}
              </text>
            )
          case "bullet":
            return <text style={{ fg: C.dim }}>{`  · ${p.text}`}</text>
          default:
            return <text>{p.text}</text>
        }
      }}
    </For>
  )
}

export function Chat(props: {
  turns: Turn[]
  streaming: string
  busy: boolean
  /** Tools del turno EN CURSO: se ven mientras corren, no al terminar. */
  liveTools?: NonNullable<Turn["tools"]>
}) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, border: true, borderColor: C.rule, paddingLeft: 1, paddingRight: 1 }}>
      <scrollbox style={{ flexGrow: 1 }}>
        <For each={props.turns}>
          {(turn) => (
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              {/* Etiqueta de rol explícita: con solo un color y un símbolo no
                  se distingue de un vistazo quién dijo qué. */}
              {/* Framing direccional: el chevron dice de qué lado viene el
                  mensaje sin gastar color ni una línea extra. */}
              <text style={{ fg: turn.role === "user" ? C.operator : C.dim }}>
                {turn.role === "user" ? ">>> VOS" : "<<< AGENTE"}
              </text>
              {/* Las tools van ANTES del texto: son lo que el agente hizo para
                  poder responder, y dejarlas después empujaba la respuesta
                  fuera de pantalla en cualquier deploy real. */}
              <Show when={turn.tools?.length}>
                <Tools tools={turn.tools!} />
              </Show>
              <Show when={turn.role === "agent"} fallback={<text>{`  ${turn.text}`}</text>}>
                <Body text={turn.text} />
              </Show>
            </box>
          )}
        </For>

        {/* El turno en curso se pinta aparte: todavía no está cerrado. */}
        <Show when={props.streaming || props.liveTools?.length}>
          <box style={{ flexDirection: "column" }}>
            <text style={{ fg: C.dim }}>{"<<< AGENTE"}</text>
            <Show when={props.liveTools?.length}>
              <Tools tools={props.liveTools!} />
            </Show>
            <Show when={props.streaming}>
              <text>{props.streaming}</text>
            </Show>
          </box>
        </Show>
      </scrollbox>

      <Show when={props.busy}>
        <text style={{ fg: C.rule }}>{"/// working"}</text>
      </Show>
    </box>
  )
}
