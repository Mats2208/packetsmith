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
        <text style={{ fg: "#e0af68" }}>{`   ● ${s().running.join(", ")}`}</text>
      </Show>
      <Show when={s().failed.length}>
        <text style={{ fg: "#f7768e" }}>{`   ✗ ${s().failed.join(", ")}`}</text>
      </Show>
      <Show when={s().ok.length}>
        <text style={{ fg: "#565f89" }}>{`   ✓ ${s().ok.join(", ")}`}</text>
      </Show>
    </>
  )
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

export function Chat(props: {
  turns: Turn[]
  streaming: string
  busy: boolean
  /** Tools del turno EN CURSO: se ven mientras corren, no al terminar. */
  liveTools?: NonNullable<Turn["tools"]>
}) {
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
            <text style={{ fg: "#7aa2f7" }}>AGENTE</text>
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
        <text style={{ fg: "#565f89" }}>pensando…</text>
      </Show>
    </box>
  )
}
