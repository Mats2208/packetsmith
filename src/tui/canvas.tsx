// Panel derecho: la topología dibujada con Unicode.
//
// No se muestra la captura PNG de PT a propósito: el dibujo propio funciona en
// cualquier terminal (Warp incluido), muestra estado que un bitmap no da (IPs,
// enlaces) y se puede navegar.
//
// Tiene DOS modos según lo que haya llegado del agente:
//   con enlaces → árbol router → switch → host
//   sin enlaces → agrupado por subred (pt_query_topology no trae enlaces)
import { For, Show } from "solid-js"
import type { Device, Topology } from "../topology/model.ts"
import { ICON, kindOf } from "../topology/model.ts"
import { buildForest, addressesOf, groupBySubnet, type Node } from "../topology/tree.ts"

const COLOR: Record<string, string> = {
  router: "#7dcfff",
  switch: "#7aa2f7",
  wireless: "#bb9af7",
  cloud: "#e0af68",
  host: "#c0caf5",
  other: "#565f89",
}

function label(d: Device): { icon: string; name: string; ips: string; color: string } {
  const k = kindOf(d.model)
  const ips = addressesOf(d)
  return {
    icon: ICON[k],
    name: d.name,
    ips: ips.length ? ips.join(" ") : "",
    color: COLOR[k] ?? COLOR.other!,
  }
}

function Row(props: { device: Device; prefix: string }) {
  const l = () => label(props.device)
  return (
    <text style={{ fg: l().color }}>
      {`${props.prefix}${l().icon} ${l().name}`}
      <Show when={l().ips}>
        <span style={{ fg: "#565f89" }}>{`  ${l().ips}`}</span>
      </Show>
    </text>
  )
}

function TreeNode(props: { node: Node; depth: number; last: boolean }) {
  const prefix = () =>
    props.depth === 0 ? "" : "  ".repeat(props.depth - 1) + (props.last ? "└ " : "├ ")
  return (
    <>
      <Row device={props.node.device} prefix={prefix()} />
      <For each={props.node.children}>
        {(c, i) => (
          <TreeNode node={c} depth={props.depth + 1} last={i() === props.node.children.length - 1} />
        )}
      </For>
    </>
  )
}

export function Canvas(props: { topology: Topology; lastTool?: string }) {
  const count = () => props.topology.devices.length
  const hasLinks = () => props.topology.links.length > 0

  return (
    <box style={{ flexDirection: "column", width: 46, border: true, padding: 1 }}>
      {/* Todo el estado va en el encabezado: abajo el scrollbox se queda con
          el alto que sobra y cualquier línea de pie termina fuera de vista.
          Y dos <text> sueltos dentro de un Show se pisan en la misma fila. */}
      <box style={{ flexDirection: "column", height: props.lastTool ? 2 : 1 }}>
        <text style={{ fg: "#4fd6be" }}>
          {`TOPOLOGÍA`}
          <span style={{ fg: "#565f89" }}>
            {count() ? `  ${count()} equipos · ${props.topology.links.length} enlaces` : ""}
          </span>
        </text>
        <Show when={props.lastTool}>
          <text style={{ fg: "#565f89" }}>{`▲ ${props.lastTool}`}</text>
        </Show>
      </box>

      <scrollbox style={{ flexGrow: 1 }}>
        <Show
          when={count()}
          fallback={<text style={{ fg: "#565f89" }}>pedile al agente que construya algo</text>}
        >
          <Show
            when={hasLinks()}
            fallback={
              // Sin enlaces no hay jerarquía posible: se agrupa por subred, que
              // es la estructura que importa en un lab.
              <For each={groupBySubnet(props.topology)}>
                {(g) => (
                  <>
                    <text style={{ fg: "#4fd6be" }}>{g.label}</text>
                    <For each={g.devices}>{(d) => <Row device={d} prefix="  " />}</For>
                  </>
                )}
              </For>
            }
          >
            <For each={buildForest(props.topology)}>
              {(n, i) => (
                <TreeNode node={n} depth={0} last={i() === buildForest(props.topology).length - 1} />
              )}
            </For>
          </Show>
        </Show>
      </scrollbox>
    </box>
  )
}
