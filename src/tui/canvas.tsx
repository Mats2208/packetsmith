// Panel derecho: la topología, como telemetría.
//
// No se muestra la captura PNG de PT a propósito: el dibujo propio funciona en
// cualquier terminal, muestra estado que un bitmap no da y se puede navegar.
//
// Dos modos según lo que llegó del agente:
//   con enlaces → árbol router → switch → host
//   sin enlaces → agrupado por subred (pt_query_topology no trae enlaces)
import { For, Show } from "solid-js"
import type { Device, Kind, Topology } from "../topology/model.ts"
import { ICON, kindOf } from "../topology/model.ts"
import { buildForest, addressesOf, censusOf, groupBySubnet, type Node } from "../topology/tree.ts"
import { C, NODE, bracket } from "./theme.ts"
import { bar, rule, SCHEMATIC } from "./ascii.ts"
import { Plate, SPLIT } from "./frame.tsx"

/** Alinea el nombre para que la columna de IPs quede a plomo. */
const PAD = 11
/** Ancho del panel. Fijo a propósito: la telemetría no se reflowea. */
const WIDTH = 42
/** Lo que queda adentro después del filete y los márgenes. */
const INNER = WIDTH - 3

/**
 * Espacios para empujar `right` contra el borde derecho del panel.
 *
 * El ancho es fijo (`WIDTH`), así que alinear a la derecha es aritmética y no
 * hace falta un layout de dos columnas para dos datos.
 */
function flush(left: string, right: string): string {
  if (!right) return ""
  // Se recorta antes que desbordar: una línea que no entra se va a la de abajo
  // y rompe la grilla — un nombre de tool largo empujaba el renglón entero.
  const room = INNER - left.length - 1
  if (room < 4) return ""
  const text = right.length > room ? right.slice(0, room - 1) + "…" : right
  return " ".repeat(INNER - left.length - text.length) + text
}

/** Plural y en castellano donde importa; el `Kind` crudo es de máquina. */
const CENSUS_LABEL: Record<Kind, string> = {
  router: "ROUTERS",
  switch: "SWITCHES",
  wireless: "WIRELESS",
  cloud: "NUBE/WAN",
  host: "HOSTS",
  other: "OTROS",
}

/**
 * Censo por familia, en barras.
 *
 * Es lo primero que se ve del panel porque responde de un vistazo la pregunta
 * que uno se hace mirando una topología ajena —de qué está hecha— sin obligar a
 * contar filas en el árbol de abajo.
 */
function Census(props: { topology: Topology }) {
  return (
    <For each={censusOf(props.topology)}>
      {(t) => (
        <text style={{ fg: NODE[t.kind] ?? NODE.other }}>
          {`${ICON[t.kind]} ${CENSUS_LABEL[t.kind].padEnd(10)}`}
          <span style={{ fg: C.rule }}>{bar(t.share, 12)}</span>
          <span style={{ fg: C.dim }}>{String(t.count).padStart(4)}</span>
        </text>
      )}
    </For>
  )
}

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
    // Sin marco: lo que separa esta zona del chat es la canaleta `┃` y un fondo
    // un punto más claro. Un rectángulo completo alrededor de cada panel daba
    // esquinas por todos lados y ninguna jerarquía.
    <box
      style={{
        flexDirection: "column",
        width: WIDTH,
        border: ["left"],
        customBorderChars: SPLIT,
        borderColor: C.rule,
        backgroundColor: C.panel,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {/* Todo el estado va ARRIBA del scrollbox. No es una preferencia: en esta
          versión de OpenTUI el scrollbox se queda con todo el alto que sobra y
          lo que se ponga después nunca llega a dibujarse. El pie con el estado
          del enlace se probó y no aparecía en pantalla. */}
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text style={{ fg: C.fg }}>
          {bracket("topology")}
          {/* Único uso del verde en toda la interfaz: el enlace con PT, que es
              el dato binario que importa de un vistazo. */}
          <span style={{ fg: props.live ? C.live : C.rule }}>
            {flush(bracket("topology"), props.live ? "● BRIDGE UP" : "○ BRIDGE DOWN")}
          </span>
        </text>
        <text style={{ fg: C.dim }}>
          {count() ? `${count()} NODES · ${links()} LINKS` : "NO DATA"}
          <span style={{ fg: C.rule }}>
            {flush(count() ? `${count()} NODES · ${links()} LINKS` : "NO DATA", props.lastTool ?? "")}
          </span>
        </text>
        <text style={{ fg: C.rule }}>{"─".repeat(INNER)}</text>
        <Show when={count()}>
          <Census topology={props.topology} />
          <text style={{ fg: C.rule }}>{"─".repeat(INNER)}</text>
        </Show>
      </box>

      <scrollbox
        style={{ flexGrow: 1 }}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: C.panel, foregroundColor: C.rule },
        }}
      >
        <Show
          when={count()}
          fallback={
            // El vacío se dibuja: un esquema apagado dice qué va a aparecer acá
            // mucho mejor que la palabra "esperando" sola en un panel en blanco.
            <box style={{ flexDirection: "column", marginTop: 1 }}>
              <Plate lines={SCHEMATIC} fg={C.rule} />
              <box style={{ height: 1, marginTop: 1 }}>
                <text style={{ fg: C.dim }}>{"awaiting deployment"}</text>
              </box>
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
                    <text style={{ fg: C.rule }}>{rule(g.label, INNER)}</text>
                    <For each={g.devices}>{(d) => <Row device={d} prefix=" " />}</For>
                  </>
                )}
              </For>
            }
          >
            <text style={{ fg: C.rule }}>{rule("fabric", INNER)}</text>
            <For each={forest()}>
              {(n, i) => <TreeNode node={n} depth={0} last={i() === forest().length - 1} />}
            </For>
          </Show>
        </Show>
      </scrollbox>

    </box>
  )
}
