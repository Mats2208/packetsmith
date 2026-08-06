// La primera pantalla.
//
// Antes era el wordmark, un diagrama y una línea de texto, todo pegado al
// borde izquierdo: correcto y sin alma. Una app de terminal se presenta una
// sola vez, y esa vez tiene que decir qué es, qué se le puede pedir y si está
// lista para trabajar.
//
// La forma junta dos cosas que funcionan: la identidad suelta y centrada
// —flota, no encabeza— y debajo un panel con secciones, que es lo que hace que
// se lea como un aparato con manual y no como un cartel.
//
// Lo que NO se copia de nadie: la lista de ejemplos es de PacketSmith y enseña
// a hablarle al agente, y la línea de estado es EN VIVO. Un cartel que dice
// "conectá Packet Tracer" no sirve; uno que dice si está conectado, sí.
import { For, Show } from "solid-js"
import { C } from "./theme.ts"
import { wordmark } from "./ascii.ts"
import { Art, Hairline } from "./frame.tsx"

/**
 * Ancho del panel: el que abraza al wordmark, que mide 50.
 *
 * Es un MÁXIMO, no un ancho fijo. Con ancho fijo, en un panel angosto la caja
 * desbordaba y se comía sus propios bordes; ninguna línea de acá adentro puede
 * depender de este número.
 */
const WIDTH = 66

/**
 * Lo que se puede pedir, en las palabras con las que uno lo pediría.
 *
 * Enseñan más que cualquier explicación de qué hace la app: son literalmente
 * copiables. El primero es de lectura a propósito —no rompe nada— para que
 * quien recién llega pueda probar sin miedo a desarmar su laboratorio.
 */
const EJEMPLOS = [
  "leé la topología y decime qué está mal",
  "3 routers con OSPF y una LAN en cada uno",
  "segmentá en VLANs por departamento",
] as const

export function Welcome(props: {
  live?: boolean
  /** Si el MCP de Packet Tracer está registrado en el CLI. */
  mcp?: boolean
}) {
  return (
    <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <Art rows={wordmark()} />

      <box style={{ height: 1, marginTop: 1, marginBottom: 1 }}>
        <text style={{ fg: C.dim }}>{"redes en Packet Tracer, dichas en castellano"}</text>
      </box>

      <box
        style={{
          width: WIDTH,
          maxWidth: "100%",
          border: true,
          borderColor: C.line,
          paddingLeft: 2,
          paddingRight: 2,
          flexShrink: 1,
        }}
        title=" CÓMO EMPIEZA "
        titleAlignment="center"
      >
        <text style={{ fg: C.dim }}>
          {"vos "}
          <span style={{ fg: C.faint }}>{"─▶"}</span>
          {" agente "}
          <span style={{ fg: C.faint }}>{"─▶"}</span>
          {" packet tracer"}
        </text>
        <text style={{ fg: C.brand }}>{"el panel de la derecha se dibuja solo"}</text>

        {/* Los separadores se dibujan con un borde y no con `─`.repeat(n):
            repetir obliga a saber el ancho, y el ancho acá es elástico. */}
        <box style={{ height: 1 }} />
        <Hairline />
        <box style={{ height: 1 }} />

        <text style={{ fg: C.fg }}>{"PROBÁ CON"}</text>
        <For each={EJEMPLOS}>
          {(e) => (
            <text style={{ fg: C.faint }}>
              {"  › "}
              <span style={{ fg: C.dim }}>{e}</span>
            </text>
          )}
        </For>

        <box style={{ height: 1 }} />
        <Hairline />
        <box style={{ height: 1 }} />

        {/* Estado en vivo, no un cartel. La pregunta que se hace todo el mundo
            al abrir esto es si el puente con Packet Tracer está levantado, y
            acá se contesta antes de que la haga.

            El MCP va PRIMERO cuando falta: sin él el agente no tiene una sola
            tool pt_*, así que el estado del puente da igual —y decir "sin
            conexión" mandaría a revisar Packet Tracer, que no es el problema. */}
        <box style={{ flexDirection: "row", height: 1 }}>
          <Show
            when={props.mcp === false}
            fallback={
              <text style={{ fg: props.live ? C.live : C.dim, flexShrink: 0 }}>
                {props.live ? "● packet tracer conectado" : "○ packet tracer sin conexión"}
              </text>
            }
          >
            <text style={{ fg: C.warn, flexShrink: 0 }}>{"⚠ falta el MCP de packet tracer"}</text>
          </Show>
          {/* `minWidth` y no solo `flexGrow`: en un panel angosto el hueco
              elástico se colapsa a cero y los dos textos se pegan
              ("conectado⏎ enviar"). Dos columnas siempre. */}
          <box style={{ flexGrow: 1, minWidth: 2 }} />
          <text style={{ fg: C.dim, flexShrink: 0 }}>{"⏎ enviar · ⇧⏎ línea"}</text>
        </box>
        <Show when={props.mcp === false}>
          <text style={{ fg: C.dim }}>
            {"  claude mcp add packet-tracer -- <python> -m packet_tracer_mcp --stdio"}
          </text>
        </Show>
        <Show when={props.mcp !== false && !props.live}>
          <text style={{ fg: C.dim }}>{"  abrí Extensiones ▸ MCP BUILDER en Packet Tracer"}</text>
        </Show>
      </box>
    </box>
  )
}
