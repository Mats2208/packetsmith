// Panel izquierdo: la conversación. Presentación pura — quien corre el motor
// y arma los turnos es app.tsx.
import { For, Show } from "solid-js"

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
 * Parte el texto en tramos de prosa y bloques de código.
 *
 * Se renderiza markdown SELECTIVO a propósito: pasarlo entero por un renderer
 * borra el aire de terminal, pero dejar los ``` crudos hace ilegible cualquier
 * respuesta con CLI de Cisco adentro, que es la mitad de lo que este agente
 * responde.
 */
export function splitCode(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) })
    out.push({ code: true, text: m[1]!.replace(/\n$/, "") })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) })
  return out.filter((p) => p.text.trim())
}

function ToolLine(props: { name: string; done: boolean; isError: boolean }) {
  const icon = () => (props.isError ? "✗" : props.done ? "✓" : "●")
  const color = () => (props.isError ? "red" : props.done ? "green" : "yellow")
  return <text style={{ fg: color() }}>{`   ${icon()} ${shortToolName(props.name)}`}</text>
}

/** Prosa y código; el código va con fondo propio para que se despegue. */
function Body(props: { text: string }) {
  return (
    <For each={splitCode(props.text)}>
      {(part) =>
        part.code ? (
          <box style={{ backgroundColor: "#12161c", paddingLeft: 1, marginTop: 1, marginBottom: 1 }}>
            <text style={{ fg: "#7fd88f" }}>{part.text}</text>
          </box>
        ) : (
          <text>{part.text.trim()}</text>
        )
      }
    </For>
  )
}

export function Chat(props: { turns: Turn[]; streaming: string; busy: boolean }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, border: true, padding: 1 }}>
      <scrollbox style={{ flexGrow: 1 }}>
        <For each={props.turns}>
          {(turn) => (
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              {/* Etiqueta de rol explícita: con solo un color y un símbolo no
                  se distingue de un vistazo quién dijo qué. */}
              <text style={{ fg: turn.role === "user" ? "#4fd6be" : "#7aa2f7" }}>
                {turn.role === "user" ? "VOS" : "AGENTE"}
              </text>
              <Show when={turn.role === "agent"} fallback={<text>{`  ${turn.text}`}</text>}>
                <Body text={turn.text} />
              </Show>
              <For each={turn.tools ?? []}>
                {(t) => <ToolLine name={t.name} done={t.done} isError={t.isError} />}
              </For>
            </box>
          )}
        </For>

        {/* El turno en curso se pinta aparte: todavía no está cerrado. */}
        <Show when={props.streaming}>
          <box style={{ flexDirection: "column" }}>
            <text style={{ fg: "#7aa2f7" }}>AGENTE</text>
            <text>{props.streaming}</text>
          </box>
        </Show>
      </scrollbox>

      <Show when={props.busy}>
        <text style={{ fg: "#565f89" }}>pensando…</text>
      </Show>
    </box>
  )
}
