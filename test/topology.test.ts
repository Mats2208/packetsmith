// El fixture reproduce el formato exacto que arma pt_export_topology en
// tool_registry.py — incluido el enlace inalámbrico, que no tiene extremo B.
import { expect, test, describe } from "bun:test"
import { ingest, parseExportTopology, unwrapToolOutput, EMPTY } from "../src/topology/ingest.ts"
import { kindOf, type Kind } from "../src/topology/model.ts"
import { groupBySubnet } from "../src/topology/tree.ts"

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
})
