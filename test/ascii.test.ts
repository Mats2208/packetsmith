// El arte es puro: strings adentro, strings afuera. Testearlo acá cuesta
// microsegundos y atrapa lo que en pantalla se ve como un dibujo roto y en el
// código no se ve como nada.
import { expect, test, describe } from "bun:test"
import { bar, rule, sweep, wordmark, WORDMARK, CHAIN, SCHEMATIC } from "../src/tui/ascii.ts"

describe("wordmark", () => {
  test("las tres filas del arte más una de reflejo", () => {
    expect(wordmark()).toHaveLength(WORDMARK.length + 1)
  })

  test("el corte entre PACKET y SMITH cae en un espacio", () => {
    // Si cayera en medio de una letra, el cambio de tono la partiría al medio.
    for (const row of WORDMARK) expect(row[27]).toBe(" ")
  })

  test("cada fila reconstruye exactamente su línea de arte", () => {
    const rows = wordmark()
    for (let i = 0; i < WORDMARK.length; i++) {
      expect(rows[i]!.map((r) => r.text).join("")).toBe(WORDMARK[i]!)
    }
  })

  test("el reflejo solo pinta donde la base tiene tinta", () => {
    const base = WORDMARK[WORDMARK.length - 1]!
    const echo = wordmark().at(-1)!.map((r) => r.text).join("")
    expect(echo).toHaveLength(base.length)
    for (let i = 0; i < base.length; i++) {
      expect(echo[i] === " ").toBe(base[i] === " ")
    }
  })
})

describe("diagramas", () => {
  test("la cadena tiene todas sus filas del mismo largo", () => {
    // Una fila corta desalinea las cajas y el diagrama deja de cerrar.
    const width = Math.max(...CHAIN.map((l) => l.length))
    for (const line of CHAIN) expect(line.padEnd(width)).toHaveLength(width)
    expect(CHAIN.join("\n")).toContain("TOPOLOGÍA")
  })

  test("el esquema del panel vacío entra en el ancho del panel", () => {
    // El panel mide 42 y descuenta filete y márgenes; si el dibujo se pasa,
    // OpenTUI lo reflowea y el esquema se desarma.
    for (const line of SCHEMATIC) expect(line.length).toBeLessThanOrEqual(39)
  })
})

describe("texturas", () => {
  test("el barrido devuelve el ancho pedido y mueve la cabeza", () => {
    expect(sweep(20, 0)).toHaveLength(20)
    expect(sweep(20, 0).indexOf("█")).toBe(0)
    expect(sweep(20, 5).indexOf("█")).toBe(5)
  })

  test("el barrido vuelve en vez de saltar al reiniciar", () => {
    // Si solo fuera de ida, al terminar el período la cabeza pegaría un salto
    // seco de la derecha a la izquierda y se leería como un glitch.
    const width = 10
    const heads = Array.from({ length: 18 }, (_, p) => sweep(width, p).indexOf("█"))
    for (let i = 1; i < heads.length; i++) {
      expect(Math.abs(heads[i]! - heads[i - 1]!)).toBe(1)
    }
  })

  test("la barra llena en proporción y nunca se pasa", () => {
    expect(bar(0, 8)).toBe("░".repeat(8))
    expect(bar(1, 8)).toBe("█".repeat(8))
    expect(bar(0.5, 8)).toBe("████░░░░")
    expect(bar(9, 8)).toBe("█".repeat(8))
    expect(bar(-1, 8)).toBe("░".repeat(8))
  })

  test("la regla titulada ocupa exactamente el ancho dado", () => {
    expect(rule("fabric", 20)).toHaveLength(20)
    expect(rule("fabric", 20)).toStartWith("── FABRIC ─")
    // Un título más largo que el ancho recorta en vez de desbordar.
    expect(rule("un titulo larguisimo", 10)).toHaveLength(10)
  })
})
