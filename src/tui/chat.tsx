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

function ToolLine(props: { name: string; done: boolean; isError: boolean }) {
  const icon = () => (props.isError ? "✗" : props.done ? "✓" : "●")
  const color = () => (props.isError ? "red" : props.done ? "green" : "yellow")
  return (
    <text style={{ fg: color() }}>
      {`  ${icon()} ${shortToolName(props.name)}`}
    </text>
  )
}

export function Chat(props: { turns: Turn[]; streaming: string; busy: boolean }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, border: true, padding: 1 }}>
      <scrollbox style={{ flexGrow: 1 }}>
        <For each={props.turns}>
          {(turn) => (
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              <text style={{ fg: turn.role === "user" ? "cyan" : "white" }}>
                {turn.role === "user" ? `› ${turn.text}` : turn.text}
              </text>
              <For each={turn.tools ?? []}>
                {(t) => <ToolLine name={t.name} done={t.done} isError={t.isError} />}
              </For>
            </box>
          )}
        </For>

        {/* El turno en curso se pinta aparte: todavía no está cerrado. */}
        <Show when={props.streaming}>
          <text>{props.streaming}</text>
        </Show>
      </scrollbox>

      <Show when={props.busy}>
        <text style={{ fg: "gray" }}>pensando…</text>
      </Show>
    </box>
  )
}
