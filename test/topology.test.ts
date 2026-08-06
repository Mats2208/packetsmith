// El fixture reproduce el formato exacto que arma pt_export_topology en
// tool_registry.py — incluido el enlace inalámbrico, que no tiene extremo B.
import { expect, test, describe } from "bun:test"
import { ingest, parseExportTopology, parseQueryTopology, unwrapToolOutput, EMPTY } from "../src/topology/ingest.ts"
import { kindOf, type Kind } from "../src/topology/model.ts"
import { buildForest, censusOf, groupBySubnet } from "../src/topology/tree.ts"

const EXPORT = `=== Topology Export: 4 devices, 3 links ===

  R1 [2911] @ (200, 90)
    GigabitEthernet0/0 IP=10.0.0.1/255.255.255.252 [linked]
    GigabitEthernet0/1 IP=192.168.0.1/255.255.255.0 [linked]
  SW1 [3560-24PS] @ (200, 230)
    GigabitEthernet0/1 [linked]
    FastEthernet0/1 [linked]
  PC1 [PC-PT] @ (70, 360)
    FastEthernet0 IP=192.168.0.3/255.255.255.0 [linked]
  AP1 [AccessPoint-PT] @ (330, 235)
    Port 0 [linked]

--- Links ---
  R1:GigabitEthernet0/1  <-->  SW1:GigabitEthernet0/1
  SW1:FastEthernet0/1  <-->  PC1:FastEthernet0
  AP1:Port 1  )))  [wireless signal]
`

describe("unwrapToolOutput", () => {
  test("destapa el {result: ...} con el que el MCP envuelve todo", () => {
    expect(unwrapToolOutput('{"result":"hola"}')).toBe("hola")
  })

  test("acepta texto plano que no es JSON", () => {
    expect(unwrapToolOutput("texto suelto")).toBe("texto suelto")
  })

  test("junta los bloques cuando el content viene como array", () => {
    // Es la forma que usa la API cuando el resultado trae varios bloques.
    expect(unwrapToolOutput([{ type: "text", text: '{"result":"x"}' }])).toBe("x")
  })
})

describe("parseExportTopology", () => {
  test("devuelve null si el texto no es un export", () => {
    expect(parseExportTopology("cualquier otra cosa")).toBeNull()
  })

  test("lee dispositivos con su modelo y posición", () => {
    const topo = parseExportTopology(EXPORT)!
    expect(topo.devices).toHaveLength(4)
    expect(topo.devices[0]).toMatchObject({ name: "R1", model: "2911", x: 200, y: 90 })
  })

  test("separa la IP del nombre del puerto", () => {
    const r1 = parseExportTopology(EXPORT)!.devices[0]!
    expect(r1.ports[0]).toMatchObject({
      name: "GigabitEthernet0/0",
      ip: "10.0.0.1/255.255.255.252",
      linked: true,
    })
  })

  test("un puerto sin IP queda sin ip, no con string vacío", () => {
    const sw1 = parseExportTopology(EXPORT)!.devices[1]!
    expect(sw1.ports[0]!.ip).toBeUndefined()
    expect(sw1.ports[0]!.linked).toBe(true)
  })

  test("lee los dos extremos de un enlace cableado", () => {
    const links = parseExportTopology(EXPORT)!.links
    expect(links[0]).toMatchObject({
      a: { device: "R1", port: "GigabitEthernet0/1" },
      b: { device: "SW1", port: "GigabitEthernet0/1" },
      wireless: false,
    })
  })

  test("el enlace inalámbrico no tiene extremo B", () => {
    // PT lo modela como antena: hay un solo puerto, no un par.
    const wireless = parseExportTopology(EXPORT)!.links.find((l) => l.wireless)!
    expect(wireless.a).toMatchObject({ device: "AP1" })
    expect(wireless.b).toBeUndefined()
  })

  test("no confunde la línea de links con un dispositivo", () => {
    const topo = parseExportTopology(EXPORT)!
    expect(topo.devices.map((d) => d.name)).not.toContain("---")
  })
})

describe("ingest", () => {
  test("actualiza la topología con un export", () => {
    const next = ingest(EMPTY, "mcp__packet-tracer__pt_export_topology", `{"result":${JSON.stringify(EXPORT)}}`)
    expect(next.devices).toHaveLength(4)
  })

  test("ignora las tools que no cambian la red", () => {
    // Una captura o una nota no alteran la topología: si esto devolviera vacío,
    // el panel se limpiaría solo cada vez que el agente saca un screenshot.
    const loaded = ingest(EMPTY, "mcp__packet-tracer__pt_export_topology", `{"result":${JSON.stringify(EXPORT)}}`)
    const after = ingest(loaded, "mcp__packet-tracer__pt_screenshot", '{"result":"/tmp/x.png"}')
    expect(after).toBe(loaded)
  })

  test("una salida ilegible deja la topología anterior en pie", () => {
    const loaded = ingest(EMPTY, "mcp__packet-tracer__pt_export_topology", `{"result":${JSON.stringify(EXPORT)}}`)
    const after = ingest(loaded, "mcp__packet-tracer__pt_export_topology", "PT error: timeout")
    expect(after).toBe(loaded)
  })
})

// ── Lo que rompió el panel contra Packet Tracer 9.0 de verdad ───────────────
//
// Este bloque NO sale de un fixture inventado: es la salida literal de
// pt_export_topology y pt_query_topology sobre una topología de cuatro equipos
// creada en PT. Trae las dos cosas que el fixture de arriba no tenía —un nombre
// con espacios y el pseudo-equipo que PT se agrega solo— y cada una rompía el
// panel de una forma distinta.
const EXPORT_REAL = `=== Topology Export: 5 devices, 3 links ===

  R1 [2911] @ (277, 85)
    GigabitEthernet0/0 [linked]
  Power Distribution Device0 [Power Distribution Device] @ (3899, 3900)
  SW1 [2960-24TT] @ (270, 238)
    GigabitEthernet0/1 [linked]
  PC1 [PC-PT] @ (177, 382)
    FastEthernet0 IP=192.168.0.2/255.255.255.0 [linked]
  PC Ventas [PC-PT] @ (377, 382)
    FastEthernet0 IP=192.168.0.3/255.255.255.0 [linked]

--- Links ---
  R1:GigabitEthernet0/0  <-->  SW1:GigabitEthernet0/1
  SW1:FastEthernet0/2  <-->  PC Ventas:FastEthernet0`

const QUERY_REAL = `DEVICES:5|LINKS:3

  R1                   [2911]  (Vlan1,GigabitEthernet0/0)
  Power Distribution Device0 [Power Distribution Device]
  SW1                  [2960-24TT]  (Vlan1,GigabitEthernet0/1)
  PC1                  [PC-PT]  (FastEthernet0=192.168.0.2/255.255.255.0,Bluetooth)
  PC Ventas            [PC-PT]  (FastEthernet0=192.168.0.3/255.255.255.0,Bluetooth)`

describe("salida real de PT 9.0", () => {
  test("un equipo con espacios en el nombre NO desaparece", () => {
    // "PC Ventas" es un nombre perfectamente legal en Packet Tracer. Con `\\S+`
    // en el regex, su línea no matcheaba y el equipo se caía del panel.
    const topo = parseExportTopology(EXPORT_REAL)!
    expect(topo.devices.map((d) => d.name)).toContain("PC Ventas")
  })

  test("y no le regala sus puertos al equipo de arriba", () => {
    // Este era el daño de verdad: la línea del equipo no matcheaba pero la de su
    // puerto SÍ, así que la interfaz y la IP de "PC Ventas" se le colgaban a
    // PC1. El panel no escondía un equipo: le atribuía una IP ajena a otro.
    const topo = parseExportTopology(EXPORT_REAL)!
    const pc1 = topo.devices.find((d) => d.name === "PC1")!
    expect(pc1.ports).toHaveLength(1)
    expect(pc1.ports[0]!.ip).toBe("192.168.0.2/255.255.255.0")
    expect(topo.devices.find((d) => d.name === "PC Ventas")!.ports[0]!.ip)
      .toBe("192.168.0.3/255.255.255.0")
  })

  test("el pseudo-equipo de PT queda afuera", () => {
    // PT se agrega solo un "Power Distribution Device" en (3899, 3900). No es
    // parte de la red y está fuera del lienzo útil: incluirlo aplasta el plano
    // entero contra una esquina y ensucia el censo con un OTROS que nadie puso.
    for (const topo of [parseExportTopology(EXPORT_REAL)!, parseQueryTopology(QUERY_REAL)!]) {
      expect(topo.devices.map((d) => d.name)).not.toContain("Power Distribution Device0")
      expect(topo.devices).toHaveLength(4)
    }
  })

  test("los enlaces no quedan apuntando a un equipo que no está en la lista", () => {
    // Un enlace huérfano no se dibuja pero SÍ se cuenta: el encabezado decía
    // "3 NODES · 3 LINKS" con un cable que no llegaba a ningún lado.
    const topo = parseExportTopology(EXPORT_REAL)!
    const nombres = new Set(topo.devices.map((d) => d.name))
    for (const l of topo.links) {
      expect(nombres.has(l.a.device)).toBe(true)
      if (l.b) expect(nombres.has(l.b.device)).toBe(true)
    }
  })

  test("query también lee los nombres con espacios", () => {
    const topo = parseQueryTopology(QUERY_REAL)!
    const pc = topo.devices.find((d) => d.name === "PC Ventas")!
    expect(pc.ports.find((p) => p.name === "FastEthernet0")!.ip).toBe("192.168.0.3/255.255.255.0")
  })
})

describe("kindOf", () => {
  // El prefijo "29" es ambiguo y fue un bug real: 2901/2911 son routers pero
  // 2950/2960 son switches, y la primera versión los metía a todos en router.
  const CASES: [string, Kind][] = [
    ["2911", "router"],
    ["2901", "router"],
    ["1941", "router"],
    ["ISR4321", "router"],
    ["2960-24TT", "switch"],
    ["2950-24", "switch"],
    ["3560-24PS", "switch"],
    ["PC-PT", "host"],
    ["Server-PT", "host"],
    ["AccessPoint-PT", "wireless"],
    ["Cloud-PT", "cloud"],
  ]

  test.each(CASES)("%s → %s", (model, expected) => {
    expect(kindOf(model)).toBe(expected)
  })
})

// ── Lo que rompió el panel en la primera prueba real ────────────────────────

const QUERY = `DEVICES:4|LINKS:3

  R1                   [2911]  (Vlan1,GigabitEthernet0/0=10.0.0.1/255.255.255.252,GigabitEthernet0/1=192.168.0.1/255.255.255.0)
  SW1                  [2960-24TT]  (Vlan1,FastEthernet0/1,GigabitEthernet0/1)
  PC1                  [PC-PT]  (FastEthernet0=192.168.0.2/255.255.255.0,Bluetooth)
  PC2                  [PC-PT]  (FastEthernet0=192.168.0.3/255.255.255.0,Bluetooth)
`

const FULL_BUILD = `============================================================
RESUMEN DE TOPOLOGÍA
============================================================
Dispositivos: 3

PLAN JSON (para uso programático)
{
  "name": "topology",
  "devices": [
    {"name":"R1","model":"2911","x":100,"y":100,"interfaces":{"GigabitEthernet0/0":"192.168.0.1/24"}},
    {"name":"SW1","model":"2960-24TT","x":100,"y":250,"interfaces":{}},
    {"name":"PC1","model":"PC-PT","x":60,"y":400,"interfaces":{"FastEthernet0":"192.168.0.2/24"}}
  ],
  "links": [
    {"device_a":"R1","port_a":"GigabitEthernet0/0","device_b":"SW1","port_b":"GigabitEthernet0/1","cable":"straight"},
    {"device_a":"SW1","port_a":"FastEthernet0/1","device_b":"PC1","port_b":"FastEthernet0","cable":"straight"}
  ]
}`

describe("ingest de las tools que el agente USA de verdad", () => {
  // El bug de la primera prueba real: el deploy funcionó, el agente llamó
  // pt_full_build / pt_query_topology / pt_health_check, y el panel quedó
  // vacío porque el ingest solo miraba pt_export_topology.
  test("pt_query_topology puebla el panel", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_query_topology", JSON.stringify({ result: QUERY }))
    expect(t.devices).toHaveLength(4)
    expect(t.devices[0]).toMatchObject({ name: "R1", model: "2911" })
  })

  test("pt_query_topology separa las IPs de los puertos", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_query_topology", JSON.stringify({ result: QUERY }))
    const r1 = t.devices[0]!
    expect(r1.ports.find((p) => p.name === "GigabitEthernet0/1")?.ip).toBe("192.168.0.1/255.255.255.0")
    // Vlan1 no tiene IP: no debe inventarse una.
    expect(r1.ports.find((p) => p.name === "Vlan1")?.ip).toBeUndefined()
  })

  test("pt_full_build trae equipos Y enlaces del plan JSON", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_full_build", JSON.stringify({ result: FULL_BUILD }))
    expect(t.devices).toHaveLength(3)
    expect(t.links).toHaveLength(2)
    expect(t.links[0]).toMatchObject({ a: { device: "R1" }, b: { device: "SW1" } })
  })

  test("un query posterior no borra los enlaces que ya teníamos", () => {
    // query_topology no trae enlaces. Si los pisara, el árbol se aplanaría
    // cada vez que el agente consulta el estado.
    const built = ingest(EMPTY, "mcp__packet-tracer__pt_full_build", JSON.stringify({ result: FULL_BUILD }))
    const after = ingest(built, "mcp__packet-tracer__pt_query_topology", JSON.stringify({ result: QUERY }))
    expect(after.links).toHaveLength(2)
    expect(after.devices).toHaveLength(4)
  })

  test("pt_health_check no toca la topología", () => {
    const built = ingest(EMPTY, "mcp__packet-tracer__pt_full_build", JSON.stringify({ result: FULL_BUILD }))
    expect(ingest(built, "mcp__packet-tracer__pt_health_check", '{"result":"ok"}')).toBe(built)
  })
})

describe("groupBySubnet", () => {
  test("agrupa por /24 cuando no hay enlaces", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_query_topology", JSON.stringify({ result: QUERY }))
    const groups = groupBySubnet(t)
    const lan = groups.find((g) => g.label === "192.168.0.0/24")!
    expect(lan.devices.map((d) => d.name)).toContain("PC1")
    expect(lan.devices.map((d) => d.name)).toContain("PC2")
  })

  test("los equipos sin IP van al final", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_query_topology", JSON.stringify({ result: QUERY }))
    const groups = groupBySubnet(t)
    expect(groups[groups.length - 1]!.label).toBe("sin IP")
    expect(groups[groups.length - 1]!.devices[0]!.name).toBe("SW1")
  })
})

describe("buildForest", () => {
  const dev = (name: string, model: string) => ({ name, model, x: 0, y: 0, ports: [] })
  const link = (a: string, b: string) => ({
    a: { device: a, port: "" }, b: { device: b, port: "" }, wireless: false,
  })

  /** Todos los nombres del bosque, incluidos los repetidos. */
  const flat = (nodes: ReturnType<typeof buildForest>): string[] =>
    nodes.flatMap((n) => [n.device.name, ...flat(n.children)])

  const CAMPUS = {
    devices: [
      dev("CORE-L3", "3560-24PS"),
      dev("SW-NORTE", "2960"), dev("SW-CENTRO", "2960"), dev("SW-SUR", "2960"),
      dev("PC-N1", "PC-PT"), dev("PC-N2", "PC-PT"),
      dev("PC-C1", "PC-PT"), dev("PC-S1", "PC-PT"),
    ],
    links: [
      link("CORE-L3", "SW-NORTE"), link("CORE-L3", "SW-CENTRO"), link("CORE-L3", "SW-SUR"),
      link("SW-NORTE", "PC-N1"), link("SW-NORTE", "PC-N2"),
      link("SW-CENTRO", "PC-C1"), link("SW-SUR", "PC-S1"),
    ],
  }

  test("ningún equipo aparece dos veces", () => {
    // El bug: `filter(no tomado).map(attach)` evalúa el filter ENTERO contra un
    // `taken` todavía vacío, así que cada equipo se volvía raíz. El panel
    // listaba la red dos veces —árbol arriba y lista plana debajo— y la
    // segunda parecía continuación de la primera.
    const nombres = flat(buildForest(CAMPUS))
    expect(nombres).toHaveLength(CAMPUS.devices.length)
    expect(new Set(nombres).size).toBe(CAMPUS.devices.length)
  })

  test("sin routers, la raíz es el equipo con más enlaces", () => {
    // Una red de puro switch no tiene raíz obvia. Antes se tomaba el primero
    // de la lista y funcionaba solo de casualidad.
    const bosque = buildForest(CAMPUS)
    expect(bosque).toHaveLength(1)
    expect(bosque[0]!.device.name).toBe("CORE-L3")
  })

  test("la raíz sigue siendo el router cuando lo hay", () => {
    const conRouter = {
      devices: [...CAMPUS.devices, dev("R-EDGE", "2911")],
      links: [...CAMPUS.links, link("R-EDGE", "CORE-L3")],
    }
    expect(buildForest(conRouter)[0]!.device.name).toBe("R-EDGE")
  })

  test("un equipo sin ningún enlace igual aparece", () => {
    // Esconderlo haría que el panel mienta sobre lo que hay en el canvas.
    const suelto = { devices: [...CAMPUS.devices, dev("SW-HUERFANO", "2960")], links: CAMPUS.links }
    expect(flat(buildForest(suelto))).toContain("SW-HUERFANO")
  })
})

describe("censusOf", () => {
  const dev = (name: string, model: string) => ({ name, model, x: 0, y: 0, ports: [] })

  test("cuenta por familia y de arriba hacia abajo de la pila", () => {
    const topo = {
      devices: [
        dev("PC1", "PC-PT"), dev("PC2", "PC-PT"), dev("PC3", "PC-PT"), dev("PC4", "PC-PT"),
        dev("SW1", "2960"), dev("SW2", "2960"),
        dev("R1", "2911"),
      ],
      links: [],
    }
    expect(censusOf(topo).map((t) => [t.kind, t.count])).toEqual([
      ["router", 1], ["switch", 2], ["host", 4],
    ])
  })

  test("la barra se escala contra el máximo, no contra el total", () => {
    // Contra el total, en un lab donde los hosts son mayoría, routers y
    // switches quedan en un muñón de una celda y las barras dejan de comparar.
    const topo = {
      devices: [dev("R1", "2911"), ...Array.from({ length: 20 }, (_, i) => dev(`PC${i}`, "PC-PT"))],
      links: [],
    }
    const census = censusOf(topo)
    expect(census.find((t) => t.kind === "host")!.share).toBe(1)
    expect(census.find((t) => t.kind === "router")!.share).toBeCloseTo(0.05)
  })

  test("no inventa familias que no están en la red", () => {
    expect(censusOf({ devices: [dev("R1", "2911")], links: [] }).map((t) => t.kind)).toEqual(["router"])
    expect(censusOf(EMPTY)).toHaveLength(0)
  })
})

describe("construcción incremental", () => {
  // El agente arma la topología con decenas de add_device/add_link. Sin
  // escuchar esas, el panel quedaba congelado durante todo el build y
  // mostraba "0 LINKS" aunque el agente hubiera cableado 13.
  const created = (n: string, m: string) =>
    JSON.stringify({ result: `Device '${n}' (${m}) created at (100, 200).` })

  test("add_device suma el equipo al panel", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_add_device", created("SW-CORE", "3560-24PS"))
    expect(t.devices).toHaveLength(1)
    expect(t.devices[0]).toMatchObject({ name: "SW-CORE", model: "3560-24PS", x: 100, y: 200 })
  })

  test("add_link suma el enlace", () => {
    let t = ingest(EMPTY, "mcp__packet-tracer__pt_add_device", created("R1", "2911"))
    t = ingest(t, "mcp__packet-tracer__pt_add_link",
      JSON.stringify({ result: "Link created: R1/GigabitEthernet0/0 <--[straight]--> SW1/GigabitEthernet0/1" }))
    expect(t.links).toHaveLength(1)
    expect(t.links[0]).toMatchObject({ a: { device: "R1" }, b: { device: "SW1" } })
  })

  test("delete_device se lleva sus enlaces", () => {
    // Si el equipo se va pero sus enlaces quedan, el árbol referencia fantasmas.
    let t = ingest(EMPTY, "mcp__packet-tracer__pt_add_device", created("R1", "2911"))
    t = ingest(t, "mcp__packet-tracer__pt_add_link",
      JSON.stringify({ result: "Link created: R1/Gi0/0 <--[straight]--> SW1/Gi0/1" }))
    t = ingest(t, "mcp__packet-tracer__pt_delete_device",
      JSON.stringify({ result: "Device 'R1' deleted from the topology." }))
    expect(t.devices).toHaveLength(0)
    expect(t.links).toHaveLength(0)
  })

  test("una salida que no matchea no rompe el estado", () => {
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_add_device", '{"result":"DUPLICATE: ya existe"}')
    expect(t).toBe(EMPTY)
  })

  // ── Las tres tools que mutan la topología y el panel ignoraba ──────────────
  // Las cadenas son las que devuelve tool_registry.py, verificadas contra PT.
  const r = (s: string) => JSON.stringify({ result: s })

  /** R1 —— SW1 —— PC1, que es lo mínimo para notar cada una de las tres. */
  const armada = () => {
    let t = ingest(EMPTY, "mcp__packet-tracer__pt_add_device", created("R1", "2911"))
    t = ingest(t, "mcp__packet-tracer__pt_add_device", created("SW1", "2960-24TT"))
    t = ingest(t, "mcp__packet-tracer__pt_add_device", created("PC1", "PC-PT"))
    t = ingest(t, "mcp__packet-tracer__pt_add_link",
      r("Link created: R1/GigabitEthernet0/0 <--[straight]--> SW1/GigabitEthernet0/1"))
    return ingest(t, "mcp__packet-tracer__pt_add_link",
      r("Link created: SW1/FastEthernet0/1 <--[straight]--> PC1/FastEthernet0"))
  }

  test("delete_link se lleva el enlace, no un cable fantasma", () => {
    // PT identifica el enlace por UN extremo: equipo e interfaz. Sin esto el
    // cable seguía dibujado y contado, y el árbol lo usaba para colgar equipos
    // de un switch al que ya no estaban conectados.
    const t = ingest(armada(), "mcp__packet-tracer__pt_delete_link",
      r("Link on SW1/FastEthernet0/1 deleted."))
    expect(t.links).toHaveLength(1)
    expect(t.links[0]).toMatchObject({ a: { device: "R1" } })
    expect(t.devices).toHaveLength(3)
  })

  test("delete_link encuentra el enlace por cualquiera de sus dos puntas", () => {
    const t = ingest(armada(), "mcp__packet-tracer__pt_delete_link",
      r("Link on PC1/FastEthernet0 deleted."))
    expect(t.links).toHaveLength(1)
  })

  test("move_device mueve el equipo, que es lo que el plano existe para mostrar", () => {
    // `layoutKey` incluye las coordenadas justamente para esto: sin actualizar,
    // pedir "corré el core a la derecha" no redibujaba nada.
    const t = ingest(armada(), "mcp__packet-tracer__pt_move_device",
      r("Device 'R1' moved to (600, 40)."))
    expect(t.devices.find((d) => d.name === "R1")).toMatchObject({ x: 600, y: 40 })
    // Los demás quedan donde estaban.
    expect(t.devices.find((d) => d.name === "SW1")).toMatchObject({ x: 100, y: 200 })
  })

  test("rename_device arrastra los enlaces con el nombre nuevo", () => {
    // El nombre es la clave con la que los enlaces referencian equipos: si solo
    // se renombra el equipo, el árbol queda colgando de un nombre que no existe.
    const t = ingest(armada(), "mcp__packet-tracer__pt_rename_device",
      r("Device renamed: 'SW1' → 'SW Ventas'"))
    expect(t.devices.map((d) => d.name)).toContain("SW Ventas")
    expect(t.devices.map((d) => d.name)).not.toContain("SW1")
    const nombres = new Set(t.devices.map((d) => d.name))
    for (const l of t.links) {
      expect(nombres.has(l.a.device)).toBe(true)
      expect(nombres.has(l.b!.device)).toBe(true)
    }
  })

  test("un enlace de un equipo con espacios en el nombre se lee entero", () => {
    // El regex acotaba el nombre a `[^/\\s]+`, así que "PC Ventas" cortaba el
    // match y el enlace se perdía sin que nadie se enterara.
    const t = ingest(EMPTY, "mcp__packet-tracer__pt_add_link",
      r("Link created: SW1/FastEthernet0/2 <--[straight]--> PC Ventas/FastEthernet0"))
    expect(t.links[0]).toMatchObject({
      a: { device: "SW1", port: "FastEthernet0/2" },
      b: { device: "PC Ventas", port: "FastEthernet0" },
    })
  })
})
