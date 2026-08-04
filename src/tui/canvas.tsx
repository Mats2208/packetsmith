// Panel derecho: la topología. Por ahora solo muestra el rastro de las tools
// `pt_*` que se van ejecutando; el árbol Unicode entra cuando exista el modelo
// de topología (ver AGENTS.md).
import { For, Show } from "solid-js"
import { shortToolName } from "./chat.tsx"

export function Canvas(props: { events: string[] }) {
  return (
    <box style={{ flexDirection: "column", width: 44, border: true, padding: 1 }}>
      <text style={{ fg: "cyan" }}>TOPOLOGÍA</text>

      <Show
        when={props.events.length}
        fallback={<text style={{ fg: "gray" }}>sin actividad todavía</text>}
      >
        <For each={props.events}>
          {(e) => <text style={{ fg: "gray" }}>{shortToolName(e)}</text>}
        </For>
      </Show>
    </box>
  )
}
