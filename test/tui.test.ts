// Los tests del TUI usan testRender + captureCharFrame: renderizan a un buffer
// de caracteres en memoria, sin tomar la terminal. Así se puede afirmar qué se
// ve realmente en pantalla en vez de suponerlo.
import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { Chat, shortToolName, type Turn } from "../src/tui/chat.tsx"
import { Canvas, guide } from "../src/tui/canvas.tsx"
import { bridgeIsUp } from "../src/tui/app.tsx"
import type { Topology } from "../src/topology/model.ts"
import { EMPTY } from "../src/topology/ingest.ts"

async function frameOf(node: () => any, width = 70, height = 14): Promise<string> {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  return await setup.captureCharFrame()
}

describe("bridgeIsUp", () => {
  test("una tool que falla NO significa que el puente esté caído", () => {
    // pt_apply_hardening rechazado apagaba el indicador verde sin motivo: el
    // que falló fue el comando, el transporte estaba perfecto.
    expect(bridgeIsUp("ERROR: SSH sin usuarios locales")).toBe(true)
  })

  test("el puente caído se anuncia en el texto, no en el flag de error", () => {
    expect(bridgeIsUp("Packet Tracer no está conectado al bridge")).toBe(false)
    expect(bridgeIsUp("bridge is NOT connected")).toBe(false)
  })
})

describe("shortToolName", () => {
  test("saca el prefijo del MCP para que quepa en el panel", () => {
    expect(shortToolName("mcp__packet-tracer__pt_full_build")).toBe("pt_full_build")
  })

  test("deja intactas las tools que no son del MCP", () => {
    expect(shortToolName("Read")).toBe("Read")
  })
})

describe("Chat", () => {
  test("etiqueta explícitamente quién dijo cada cosa", async () => {
    // Con solo un color y un símbolo no se distinguía de un vistazo de quién
    // era cada mensaje; fue lo primero que se notó usando la app.
    const turns: Turn[] = [
      { role: "user", text: "crea 3 routers" },
      { role: "agent", text: "listo" },
    ]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    expect(frame).toContain("VOS")
    expect(frame).toContain("AGENTE")
    expect(frame).toContain("crea 3 routers")
    expect(frame).toContain("listo")
  })

  test("cada mensaje lleva su canaleta a lo largo de todo el bloque", async () => {
    // La canaleta es lo que dice de quién es el mensaje cuando la respuesta
    // pasa de una pantalla y el encabezado ya se fue para arriba.
    const turns: Turn[] = [{ role: "agent", text: "linea uno\nlinea dos\nlinea tres" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    const marked = frame.split("\n").filter((l) => l.includes("▌"))
    expect(marked.length).toBeGreaterThanOrEqual(4)
  })

  test("los bloques de código se despegan de la prosa", async () => {
    const turns: Turn[] = [{
      role: "agent",
      text: "Pegá esto:\n```\nenable\nconfigure terminal\n```\nY listo.",
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }), 70, 16)

    expect(frame).toContain("configure terminal")
    // Los ``` no se muestran crudos: se convierten en un bloque con fondo.
    expect(frame).not.toContain("```")
  })

  test("muestra el texto que está llegando antes de cerrar el turno", async () => {
    // Es la razón de ser del streaming: si esto no se ve, el usuario espera
    // mirando una pantalla quieta hasta que el agente termina.
    const frame = await frameOf(() => Chat({ turns: [], streaming: "escribiendo…", busy: true }))
    expect(frame).toContain("escribiendo…")
  })

  test("marca las tools según su estado, como badges", async () => {
    const turns: Turn[] = [{
      role: "agent",
      text: "hecho",
      tools: [
        { name: "mcp__packet-tracer__pt_full_build", done: true, isError: false },
        { name: "mcp__packet-tracer__pt_add_device", done: true, isError: true },
        { name: "mcp__packet-tracer__pt_screenshot", done: false, isError: false },
      ],
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))

    // El rojo es el único acento y se reserva para lo que falló; lo que salió
    // bien va apagado, porque no hay nada que decidir con eso.
    expect(frame).toContain("✗ pt_add_device")
    expect(frame).toContain("pt_full_build")
    // Lo que sigue corriendo va primero: es lo único sobre lo que se puede
    // esperar algo. Lo que falló, segundo. Lo que salió bien no urge.
    expect(frame.indexOf("pt_screenshot")).toBeLessThan(frame.indexOf("pt_add_device"))
    expect(frame.indexOf("pt_add_device")).toBeLessThan(frame.indexOf("pt_full_build"))
  })

  test("los badges entran varios por renglón", async () => {
    // Con una tool por línea, un deploy real de veinte llamadas se comía la
    // pantalla entera antes de que empezara la respuesta.
    const tools = ["a", "b", "c", "d"].map((n) => ({
      name: `mcp__packet-tracer__pt_${n}`, done: true, isError: false,
    }))
    const frame = await frameOf(() => Chat({ turns: [{ role: "agent", text: "ok", tools }], streaming: "", busy: false }))
    const row = frame.split("\n").find((l) => l.includes("pt_a"))!
    expect(row).toContain("pt_b")
  })
})

describe("Canvas", () => {
  const TOPO: Topology = {
    devices: [
      { name: "R1", model: "2911", x: 200, y: 90, ports: [
        { name: "Gi0/1", ip: "192.168.0.1/255.255.255.0", linked: true },
      ] },
      { name: "SW1", model: "3560-24PS", x: 200, y: 230, ports: [
        { name: "Gi0/1", linked: true },
      ] },
      { name: "PC1", model: "PC-PT", x: 70, y: 360, ports: [
        { name: "Fa0", ip: "192.168.0.3/255.255.255.0", linked: true },
      ] },
    ],
    links: [
      { a: { device: "R1", port: "Gi0/1" }, b: { device: "SW1", port: "Gi0/1" }, wireless: false },
      { a: { device: "SW1", port: "Fa0/1" }, b: { device: "PC1", port: "Fa0" }, wireless: false },
    ],
  }

  test("el panel vacío dibuja el esquema de lo que va a aparecer", async () => {
    // Un panel en blanco con la palabra "esperando" no dice qué se espera.
    const frame = await frameOf(() => Canvas({ topology: EMPTY }), 44, 20)
    expect(frame).toContain("[ TOPOLOGY ]")
    expect(frame).toContain("awaiting deployment")
    expect(frame).toContain("┌─────┐")
    // El esquema tiene que llegar entero hasta los hosts, no cortarse arriba.
    expect(frame).toContain("▪   ▪")
  })

  test("censa la red por familia antes del árbol", async () => {
    // Responde de un vistazo de qué está hecha la topología, sin obligar a
    // contar filas en el árbol de abajo.
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 44, 20)
    expect(frame).toContain("ROUTERS")
    expect(frame).toContain("SWITCHES")
    expect(frame).toContain("HOSTS")
    expect(frame).toContain("█")
  })

  test("recorta la cola en vez de dejar que empuje el renglón", async () => {
    // Un nombre de tool largo hacía saltar la línea entera y rompía la grilla.
    const frame = await frameOf(
      () => Canvas({ topology: TOPO, lastTool: "pt_install_modules_batch_larguísimo" }), 44, 20)
    const row = frame.split("\n").find((l) => l.includes("NODES"))!
    expect(row).toContain("…")
  })

  test("dibuja la jerarquía router → switch → host", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)

    expect(frame).toContain("R1")
    expect(frame).toContain("SW1")
    expect(frame).toContain("PC1")
    // La sangría es lo que comunica la jerarquía: sin ella es una lista plana.
    const rows = frame.split("\n")
    const r1 = rows.findIndex((l) => l.includes("R1"))
    const pc1 = rows.findIndex((l) => l.includes("PC1"))
    expect(rows[pc1]!.indexOf("PC1")).toBeGreaterThan(rows[r1]!.indexOf("R1"))
    expect(frame).toContain("└── ")
  })

  test("las IPs quedan a plomo por más hondo que esté el equipo", async () => {
    // El relleno era relativo a la sangría, así que a tercer nivel el nombre se
    // quedaba sin espacio y salía pegado: "SRV1192.168.1.10".
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)
    const cols = frame.split("\n")
      .filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l))
      .map((l) => l.search(/\d+\.\d+\.\d+\.\d+/))
    expect(new Set(cols).size).toBe(1)
  })

  test("avisa cuando la lista viene sin enlaces", async () => {
    // `pt_query_topology` cuenta los enlaces pero no los devuelve. Una lista
    // plana sin aviso se lee como si esa fuera la red.
    const plana = { devices: TOPO.devices, links: [] }
    const frame = await frameOf(() => Canvas({ topology: plana }), 46, 16)
    expect(frame).toContain("sin enlaces")
    expect(frame).toContain("pt_export_topology")
  })

  test("el indicador de enlace distingue conectado de no conectado", async () => {
    // Único uso del verde en toda la interfaz: si todo resalta, nada resalta.
    const off = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)
    const on = await frameOf(() => Canvas({ topology: TOPO, live: true }), 46, 14)
    expect(off).toContain("○ BRIDGE DOWN")
    expect(on).toContain("● BRIDGE UP")
  })

  test("el estado vive ARRIBA del scrollbox, no debajo", async () => {
    // En esta versión de OpenTUI el scrollbox se queda con todo el alto que
    // sobra: cualquier pie que se ponga después nunca llega a dibujarse.
    const frame = await frameOf(() => Canvas({ topology: TOPO, live: true }), 46, 14)
    const rows = frame.split("\n")
    expect(rows.findIndex((l) => l.includes("BRIDGE UP")))
      .toBeLessThan(rows.findIndex((l) => l.includes("R1")))
  })

  test("muestra las IPs junto a cada equipo", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO }), 46, 14)
    expect(frame).toContain("192.168.0.1")
  })

  test("resume el tamaño de la red en el encabezado", async () => {
    const frame = await frameOf(() => Canvas({ topology: TOPO, lastTool: "pt_full_build" }), 46, 14)
    expect(frame).toContain("3 NODES · 2 LINKS")
  })
})

describe("guías del árbol", () => {
  // Sin las verticales, un host de tercer nivel no dice de qué switch cuelga:
  // hay que contar espacios. `ancestors[i]` dice si ese ancestro todavía tiene
  // hermanos abajo; el último elemento es el padre directo y lo reemplaza el
  // conector, así que no dibuja vertical.
  test("una raíz no lleva guía", () => {
    expect(guide([], true)).toBe("")
  })

  test("el último hijo cierra la rama y los demás la continúan", () => {
    expect(guide([true], true)).toBe("└── ")
    expect(guide([true], false)).toBe("├── ")
  })

  test("la vertical baja solo mientras el ancestro tenga hermanos", () => {
    expect(guide([true, false], false)).toBe("│  ├── ")
    expect(guide([false, true], false)).toBe("   ├── ")
  })
})

describe("markdown selectivo", () => {
  test("los encabezados se destacan sin dejar los ##", async () => {
    const turns: Turn[] = [{ role: "agent", text: "## Verificación\ntodo ok" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    expect(frame).toContain("VERIFICACIÓN")
    expect(frame).not.toContain("##")
  })

  test("las tablas se alinean en columnas", async () => {
    // Una tabla desalineada es peor que no tenerla: el pipe crudo no dice nada.
    const turns: Turn[] = [{
      role: "agent",
      text: "| Prueba | Resultado |\n|---|---|\n| PC1 → SRV | 4/4 |",
    }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }), 70, 12)
    expect(frame).toContain("Prueba")
    expect(frame).toContain("4/4")
    expect(frame).not.toContain("|---|")
  })

  test("dos párrafos no quedan pegados", async () => {
    // Los renglones en blanco del markdown se descartaban, así que oraciones
    // sueltas se leían como un muro. El salto que puso el modelo es
    // información: dice dónde termina una idea.
    const turns: Turn[] = [{ role: "agent", text: "Primera idea.\n\nSegunda idea." }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    const rows = frame.split("\n")
    const a = rows.findIndex((l) => l.includes("Primera"))
    const b = rows.findIndex((l) => l.includes("Segunda"))
    expect(b - a).toBe(2)
  })

  test("los renglones de una misma oración siguen juntos", async () => {
    // El salto simple dentro de un párrafo no separa ideas: si también abriera
    // hueco, una respuesta normal quedaría al doble de alto sin ganar nada.
    const turns: Turn[] = [{ role: "agent", text: "Una línea.\nLa de al lado." }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    const rows = frame.split("\n")
    expect(rows.findIndex((l) => l.includes("al lado")) -
      rows.findIndex((l) => l.includes("Una línea"))).toBe(1)
  })

  test("un encabezado siempre respira arriba", async () => {
    const turns: Turn[] = [{ role: "agent", text: "Texto.\n## Sección\nmás texto" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    const rows = frame.split("\n")
    expect(rows.findIndex((l) => l.includes("SECCIÓN")) -
      rows.findIndex((l) => l.includes("Texto."))).toBe(2)
  })

  test("el bold y el código inline pierden el marcado, no el texto", async () => {
    const turns: Turn[] = [{ role: "agent", text: "**Antes:** 9 equipos con `Gi0/1`" }]
    const frame = await frameOf(() => Chat({ turns, streaming: "", busy: false }))
    expect(frame).toContain("Antes:")
    expect(frame).toContain("Gi0/1")
    expect(frame).not.toContain("**")
    expect(frame).not.toContain("`")
  })
})

describe("pantalla de bienvenida", () => {
  const welcome = (live?: boolean) =>
    frameOf(() => Chat({ turns: [], streaming: "", busy: false, live }), 76, 26)

  test("el wordmark se dibuja completo, no colapsado", async () => {
    // Gotcha de OpenTUI: varios <text> hermanos se pintan sobre la MISMA fila,
    // y un <text> multilínea sin altura declarada deja que el siguiente le pise
    // las últimas. El wordmark de 3 filas llegó a verse como 1.
    const rows = (await welcome()).split("\n").filter((r) => r.includes("█"))
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test("enseña qué pedir, con frases copiables", async () => {
    // Explicar qué hace la app no sirve tanto como mostrar tres cosas que se
    // pueden pegar tal cual. La primera es de LECTURA a propósito: quien recién
    // llega prueba sin miedo a desarmar su laboratorio.
    const frame = await welcome()
    expect(frame).toContain("PROBÁ CON")
    expect(frame).toContain("leé la topología")
    expect(frame).toContain("OSPF")
  })

  test("el estado del puente es en vivo, no un cartel", async () => {
    // La pregunta que se hace todo el mundo al abrir esto es si Packet Tracer
    // está conectado. Se contesta antes de que la haga.
    expect(await welcome(false)).toContain("sin conexión")
    expect(await welcome(false)).toContain("MCP BUILDER")

    const on = await welcome(true)
    expect(on).toContain("packet tracer conectado")
    // Con el puente arriba no hay nada que arreglar: la instrucción sobra.
    expect(on).not.toContain("MCP BUILDER")
  })

  test("desaparece al primer mensaje", async () => {
    // Una portada permanente robaría las filas que el chat necesita.
    const used = await frameOf(
      () => Chat({ turns: [{ role: "user", text: "hola" }], streaming: "", busy: false }), 76, 26)
    expect(used).not.toContain("PROBÁ CON")
    expect(used).toContain("hola")
  })
})
