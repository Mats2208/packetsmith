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

/** Columna donde arranca la IP. Fija: es lo que mantiene la grilla a plomo. */
const IP_COL = 22
/** Ancho del panel. Fijo a propósito: la telemetría no se reflowea. */
export const WIDTH = 42
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

  // Nombre e ícono se rellenan hasta una columna FIJA, no relativa a la
  // sangría: así las IPs quedan todas a plomo por más hondo que esté el equipo.
  // Con el relleno relativo, un host de tercer nivel se quedaba sin espacio y
  // salía "SRV1192.168.1.10".
  const label = () => {
    const raw = `${ICON[kind()]} ${props.device.name}`
    const room = IP_COL - props.prefix.length
    return raw.length >= room ? raw.slice(0, room - 2) + "… " : raw.padEnd(room)
  }

  return (
    <text style={{ fg: C.rule }}>
      {/* La guía va en tono de estructura y el equipo en el suyo: así el árbol
          se lee como andamio y los nombres no compiten con las líneas. */}
      {props.prefix}
      <span style={{ fg: NODE[kind()] ?? NODE.other }}>{label()}</span>
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

/**
 * Guías del árbol.
 *
 * `ancestors[i]` dice si el ancestro de ese nivel todavía tiene hermanos abajo.
 * De ahí sale `│` (la rama sigue) o espacio (la rama terminó), que es lo que
 * convierte una lista sangrada en un andamio: sin las verticales, un host de
 * tercer nivel no dice de qué switch cuelga — hay que contar espacios.
 */
export function guide(ancestors: readonly boolean[], last: boolean): string {
  if (!ancestors.length) return ""
  const trunk = ancestors.slice(0, -1).map((more) => (more ? "│  " : "   ")).join("")
  return `${trunk}${last ? "└──" : "├──"} `
}

function TreeNode(props: { node: Node; ancestors: boolean[]; last: boolean }) {
  const kids = () => props.node.children
  return (
    <>
      <Row device={props.node.device} prefix={guide(props.ancestors, props.last)} />
      <For each={kids()}>
        {(c, i) => (
          <TreeNode
            node={c}
            ancestors={[...props.ancestors, !props.last]}
            last={i() === kids().length - 1}
          />
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
        <text style={{ fg: C.brand }}>
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
              // estructura que importa en un lab. Y se DICE que está degradado:
              // una lista plana sin aviso se lee como si esa fuera la red, y
              // `pt_query_topology` no devuelve enlaces aunque los cuente.
              <>
                <text style={{ fg: C.warn }}>{"⚠ sin enlaces — lista plana"}</text>
                <text style={{ fg: C.rule }}>{"  pedí pt_export_topology"}</text>
                <box style={{ height: 1 }} />
                <For each={groupBySubnet(props.topology)}>
                  {(g) => (
                    <>
                      <text style={{ fg: C.rule }}>{rule(g.label, INNER)}</text>
                      <For each={g.devices}>{(d) => <Row device={d} prefix=" " />}</For>
                    </>
                  )}
                </For>
              </>
            }
          >
            <text style={{ fg: C.rule }}>{rule("fabric", INNER)}</text>
            {/* Cada raíz va como `last`: los routers no son hermanos entre sí
                colgando de un padre común, son árboles distintos. Marcarlos
                como no-últimos dibujaba una vertical bajo el primero que
                sugería un parentesco que no existe. */}
            <For each={forest()}>
              {(n) => <TreeNode node={n} ancestors={[]} last />}
            </For>
          </Show>
        </Show>
      </scrollbox>

    </box>
  )
}
