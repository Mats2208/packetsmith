// El plano usa las coordenadas REALES del canvas de Packet Tracer, así que lo
// que hay que verificar es que la disposición sobreviva la escala: quién queda
// arriba de quién, quién a la izquierda de quién, y que nada se pise.
import { expect, test, describe } from "bun:test"
import { drawMap, strokeFor } from "../src/topology/map.ts"
import type { Topology } from "../src/topology/model.ts"

const dev = (name: string, model: string, x: number, y: number) => ({ name, model, x, y, ports: [] })
const link = (a: string, b: string) => ({
  a: { device: a, port: "" }, b: { device: b, port: "" }, wireless: false,
})

/** Estrella de dos niveles, con las coordenadas típicas de un lab de PT. */
const LAB: Topology = {
  devices: [
    dev("R-EDGE", "2911", 400, 60),
    dev("SW-CORE", "3560-24PS", 400, 180),
    dev("SW-VENTAS", "2960", 120, 300),
    dev("SW-IT", "2960", 300, 300),
    dev("SW-RRHH", "2960", 500, 300),
    dev("SW-DATACENTER", "2960", 680, 300),
    dev("PC-VEN1", "PC-PT", 80, 420),
    dev("PC-VEN2", "PC-PT", 165, 420),
    dev("PC-IT1", "PC-PT", 260, 420),
    dev("PC-IT2", "PC-PT", 345, 420),
    dev("SRV-WEB", "Server-PT", 640, 420),
    dev("SRV-DNS", "Server-PT", 725, 420),
  ],
  links: [
    link("R-EDGE", "SW-CORE"),
    link("SW-CORE", "SW-VENTAS"), link("SW-CORE", "SW-IT"),
    link("SW-CORE", "SW-RRHH"), link("SW-CORE", "SW-DATACENTER"),
    link("SW-VENTAS", "PC-VEN1"), link("SW-VENTAS", "PC-VEN2"),
    link("SW-IT", "PC-IT1"), link("SW-IT", "PC-IT2"),
    link("SW-DATACENTER", "SRV-WEB"), link("SW-DATACENTER", "SRV-DNS"),
  ],
}

const lines = (t: Topology, width = 78) =>
  drawMap(t, { width, maxHeight: 15 }).map((row) => row.map((s) => s.text).join(""))

describe("drawMap", () => {
  test("respeta el orden vertical del canvas", () => {
    const out = lines(LAB)
    const rowOf = (name: string) => out.findIndex((l) => l.includes(name))
    expect(rowOf("R-EDGE")).toBeLessThan(rowOf("SW-CORE"))
    expect(rowOf("SW-CORE")).toBeLessThan(rowOf("SW-VENTAS"))
  })

  test("respeta el orden horizontal del canvas", () => {
    const out = lines(LAB)
    const row = out.find((l) => l.includes("SW-VENTAS"))!
    expect(row.indexOf("SW-VENTAS")).toBeLessThan(row.indexOf("SW-IT"))
    expect(row.indexOf("SW-IT")).toBeLessThan(row.indexOf("SW-RRHH"))
  })

  test("nunca se pasa del ancho pedido", () => {
    for (const w of [40, 60, 78, 120]) {
      for (const line of lines(LAB, w)) expect(line.length).toBeLessThanOrEqual(w)
    }
  })

  test("solo nombra la infraestructura", () => {
    // Ocho hosts en una fila salían pegados —"▪ PC-VEN1▪ PC-VEN2"— y son justo
    // los que el árbol del panel ya lista uno por uno con su IP.
    const out = lines(LAB).join("\n")
    expect(out).toContain("SW-VENTAS")
    expect(out).not.toContain("PC-VEN1")
  })

  test("los nombres no se pisan entre sí", () => {
    // Cada etiqueta se recorta a lo que haya hasta el vecino de su misma fila.
    for (const line of lines(LAB, 46)) {
      expect(line).not.toMatch(/[A-Z0-9][◆▣▪◌☁]/)
    }
  })

  test("el alto sale de las capas de la red, no de un número fijo", () => {
    // Dos capas en un marco de quince filas quedan flotando en un mar de aire.
    const dos: Topology = {
      devices: [dev("R1", "2911", 100, 100), dev("PC1", "PC-PT", 100, 300)],
      links: [link("R1", "PC1")],
    }
    expect(lines(dos)).toHaveLength(5)
    expect(lines(LAB).length).toBeGreaterThan(5)
  })

  test("no dibuja nada si no hay coordenadas", () => {
    // `pt_query_topology` devuelve todos los equipos en (0,0): el plano saldría
    // como una sola celda con catorce nodos encima.
    const planos: Topology = {
      devices: LAB.devices.map((d) => ({ ...d, x: 0, y: 0 })),
      links: LAB.links,
    }
    expect(lines(planos)).toHaveLength(0)
  })

  test("no dibuja nada con un solo equipo", () => {
    expect(lines({ devices: [dev("R1", "2911", 10, 10)], links: [] })).toHaveLength(0)
  })
})

describe("strokeFor", () => {
  test("la diagonal se reserva para pendientes cercanas a 45°", () => {
    // Con la regla ingenua —cualquier pendiente que no sea recta va en
    // diagonal— un enlace casi horizontal salía como treinta `╱` seguidos, o
    // sea una banda maciza en vez de una línea.
    expect(strokeFor(30, 2)).toBe("─")
    expect(strokeFor(2, 30)).toBe("│")
    expect(strokeFor(10, 10)).toBe("╲")
    expect(strokeFor(-10, 10)).toBe("╱")
  })
})
