// El fixture reproduce el formato exacto que arma pt_export_topology en
// tool_registry.py — incluido el enlace inalámbrico, que no tiene extremo B.
import { expect, test, describe } from "bun:test"
import { ingest, parseExportTopology, unwrapToolOutput, EMPTY } from "../src/topology/ingest.ts"
import { kindOf, type Kind } from "../src/topology/model.ts"

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
