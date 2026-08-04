// Panel derecho: la topología, como telemetría.
//
// No se muestra la captura PNG de PT a propósito: el dibujo propio funciona en
// cualquier terminal, muestra estado que un bitmap no da y se puede navegar.
//
// Dos modos según lo que llegó del agente:
//   con enlaces → árbol router → switch → host
//   sin enlaces → agrupado por subred (pt_query_topology no trae enlaces)
import { For, Show } from "solid-js"
import type { Device, Topology } from "../topology/model.ts"
import { ICON, kindOf } from "../topology/model.ts"
import { buildForest, addressesOf, groupBySubnet, type Node } from "../topology/tree.ts"
import { C, NODE, bracket } from "./theme.ts"

/** Alinea el nombre para que la columna de IPs quede a plomo. */
const PAD = 11

function Row(props: { device: Device; prefix: string }) {
  const kind = () => kindOf(props.device.model)
  const ips = () => addressesOf(props.device)
  const name = () => props.device.name.padEnd(PAD - props.prefix.length).slice(0, PAD)

  return (
    <text style={{ fg: NODE[kind()] ?? NODE.other }}>
      {`${props.prefix}${ICON[kind()]} ${name()}`}
      <Show when={ips().length}>
        <span style={{ fg: C.dim }}>{ips()[0]}</span>
      </Show>
      {/* Un router con varias IPs: la segunda se insinúa, no compite. */}
      <Show when={ips().length > 1}>
        <span style={{ fg: C.rule }}>{` +${ips().length - 1}`}</span>
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

export function Canvas(props: { topology: Topology; lastTool?: string; live?: boolean }) {
  const count = () => props.topology.devices.length
  const links = () => props.topology.links.length
  const forest = () => buildForest(props.topology)

  return (
    <box style={{ flexDirection: "column", width: 40, border: true, borderColor: C.rule, paddingLeft: 1, paddingRight: 1 }}>
      {/* Encabezado: todo el estado va acá. Abajo el scrollbox se queda con el
          alto que sobra y cualquier línea de pie termina fuera de vista. */}
      <box style={{ flexDirection: "column", height: 2 }}>
        <text style={{ fg: C.fg }}>
          {bracket("topology")}
          {/* Único uso del verde: el enlace con PT, que es el dato binario
              que importa de un vistazo. */}
          <span style={{ fg: props.live ? C.live : C.rule }}>{props.live ? "  ●" : "  ○"}</span>
        </text>
        <text style={{ fg: C.dim }}>
          {count() ? `${count()} NODES / ${links()} LINKS` : "NO DATA"}
        </text>
      </box>

      <scrollbox style={{ flexGrow: 1 }}>
        <Show
          when={count()}
          fallback={
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <text style={{ fg: C.rule }}>{"───────────────────────"}</text>
              <text style={{ fg: C.dim }}>{" awaiting deployment"}</text>
            </box>
          }
        >
          <Show
            when={links()}
            fallback={
              // Sin enlaces no hay jerarquía: se agrupa por /24, que es la
              // estructura que importa en un lab.
              <For each={groupBySubnet(props.topology)}>
                {(g) => (
                  <>
                    <text style={{ fg: C.rule }}>{`── ${g.label} ${"─".repeat(Math.max(0, 20 - g.label.length))}`}</text>
                    <For each={g.devices}>{(d) => <Row device={d} prefix=" " />}</For>
                  </>
                )}
              </For>
            }
          >
            <For each={forest()}>
              {(n, i) => <TreeNode node={n} depth={0} last={i() === forest().length - 1} />}
            </For>
          </Show>
        </Show>
      </scrollbox>

      <Show when={props.lastTool}>
        <text style={{ fg: C.rule }}>{`/// ${props.lastTool}`}</text>
      </Show>
    </box>
  )
}
