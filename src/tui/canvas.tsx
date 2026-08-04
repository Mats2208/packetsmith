// Panel derecho: la topología dibujada con Unicode.
//
// No se muestra la captura PNG de PT a propósito: el dibujo propio funciona en
// cualquier terminal (Warp incluido), muestra estado que un bitmap no da (IPs,
// enlaces) y se puede navegar. La captura queda para `pt_screenshot`.
import { For, Show } from "solid-js"
import type { Topology } from "../topology/model.ts"
import { ICON, kindOf } from "../topology/model.ts"
import { buildForest, addressesOf, type Node } from "../topology/tree.ts"

function Line(props: { node: Node; depth: number; last: boolean }) {
  const d = () => props.node.device
  const kind = () => kindOf(d().model)
  const ips = () => addressesOf(d())

  // La sangría dibuja la rama; la raíz no lleva prefijo.
  const prefix = () => (props.depth === 0 ? "" : "  ".repeat(props.depth - 1) + (props.last ? "└ " : "├ "))

  const color = () =>
    kind() === "router" ? "cyan" : kind() === "switch" ? "blue" : kind() === "wireless" ? "magenta" : "white"

  return (
    <>
      <text style={{ fg: color() }}>
        {`${prefix()}${ICON[kind()]} ${d().name}`}
        <Show when={ips().length}>
          <span style={{ fg: "gray" }}>{`  ${ips().join(" ")}`}</span>
        </Show>
      </text>
      <For each={props.node.children}>
        {(child, i) => (
          <Line node={child} depth={props.depth + 1} last={i() === props.node.children.length - 1} />
        )}
      </For>
    </>
  )
}

export function Canvas(props: { topology: Topology; lastTool?: string }) {
  const forest = () => buildForest(props.topology)
  const count = () => props.topology.devices.length

  return (
    <box style={{ flexDirection: "column", width: 46, border: true, padding: 1 }}>
      {/* Encabezado en su propio box de columna: dos <text> sueltos dentro de
          un Show se dibujan sobre la MISMA fila y se pisan entre sí.
          Todo el estado va acá arriba porque abajo el scrollbox se queda con
          el alto que sobre y cualquier línea de pie termina fuera de vista. */}
      <box style={{ flexDirection: "column", height: props.lastTool ? 2 : 1 }}>
        <text style={{ fg: "cyan" }}>
          {`TOPOLOGÍA`}
          <span style={{ fg: "gray" }}>
            {count() ? `  ${count()} equipos · ${props.topology.links.length} enlaces` : ""}
          </span>
        </text>
        <Show when={props.lastTool}>
          <text style={{ fg: "gray" }}>{`▲ ${props.lastTool}`}</text>
        </Show>
      </box>

      <scrollbox style={{ flexGrow: 1 }}>
        <Show
          when={count()}
          fallback={<text style={{ fg: "gray" }}>pedile al agente que construya algo</text>}
        >
          <For each={forest()}>
            {(node, i) => <Line node={node} depth={0} last={i() === forest().length - 1} />}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
