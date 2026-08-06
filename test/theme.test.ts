// El contraste, verificado y no prometido.
//
// La paleta original tenía texto informativo a 1.38:1 —el modelo de cada
// equipo, los nombres de interfaz, la línea de ⏱, las instrucciones de la
// bienvenida— y nadie se dio cuenta durante varias versiones, porque "se ve
// bien" es una opinión que depende del monitor del que mira. Este archivo la
// convierte en un número.
import { expect, test, describe } from "bun:test"
import { contrast, luminance, rgb, worst } from "../src/tui/contrast.ts"
import { audit, NODE_MIN, ROLES } from "../src/tui/palette.ts"
import { DEFAULT_THEME, findTheme, THEMES } from "../src/tui/themes.ts"

describe("matemática de contraste", () => {
  test("los extremos dan lo que dice la norma", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1)
    expect(contrast("#7A7A7A", "#7A7A7A")).toBeCloseTo(1, 5)
  })

  test("no importa el orden", () => {
    expect(contrast("#0A0A0A", "#EAEAEA")).toBeCloseTo(contrast("#EAEAEA", "#0A0A0A"), 6)
  })

  test("acepta la forma corta y sin almohadilla", () => {
    expect(rgb("#fff")).toEqual([255, 255, 255])
    expect(rgb("0A0A0A")).toEqual([10, 10, 10])
  })

  test("la luminancia respeta el peso del verde", () => {
    // El ojo ve el verde mucho más que el azul: 0.7152 contra 0.0722. Sin eso,
    // un cian y un azul del mismo valor parecerían igual de legibles y no lo son.
    expect(luminance("#00FF00")).toBeGreaterThan(luminance("#0000FF"))
  })

  test("worst() se queda con el peor fondo, no con el primero", () => {
    // Un color puede leerse sobre el fondo general y desaparecer dentro del
    // panel. Mirar solo el primero es cómo se cuela justamente eso.
    expect(worst("#808080", ["#000000", "#FFFFFF"]))
      .toBeCloseTo(Math.min(contrast("#808080", "#000000"), contrast("#808080", "#FFFFFF")), 6)
  })
})

describe("todos los temas cumplen su contrato", () => {
  // Es EL test de esta tanda. Un tema que no lo pasa no se publica: sin esto,
  // "contraste real" es una intención y no una propiedad.
  test.each(THEMES.map((t) => [t.name, t] as const))("%s", (_nombre, tema) => {
    const fallas = audit(tema.colors)
    const detalle = fallas
      .map((f) => `${f.rol} ${f.ratio.toFixed(2)}:1 (${f.tipo === "bajo" ? "mínimo" : "máximo"} ${f.limite})`)
      .join(", ")
    expect(detalle).toBe("")
  })
})

describe("el contrato en sí", () => {
  test("el texto principal pide mucho más que el cromo", () => {
    // Es la separación que arregla el defecto de origen: `line` puede ser casi
    // invisible porque solo dibuja filetes, y por eso NO puede pintar texto.
    expect(ROLES.fg.min).toBeGreaterThan(ROLES.dim.min)
    expect(ROLES.dim.min).toBeGreaterThan(ROLES.faint.min)
    expect(ROLES.faint.min).toBeGreaterThan(ROLES.line.min)
  })

  test("el cromo tiene tope, no solo piso", () => {
    // Un filete demasiado brillante deja de leerse como estructura y compite
    // con el texto. El contrato va en las dos direcciones.
    expect(ROLES.line.max).toBeDefined()
    expect(ROLES.line.max).toBeLessThan(ROLES.dim.min)
  })

  test("los errores llegan a AA", () => {
    // El rojo original daba 4.26:1, apenas por debajo. Era el color con el que
    // se avisa que algo se rompió.
    expect(ROLES.alert.min).toBeGreaterThanOrEqual(4.5)
  })

  test("audit() detecta un rol por debajo", () => {
    const roto = { ...THEMES[0]!.colors, dim: "#1A1A1A" }
    expect(audit(roto).some((f) => f.rol === "dim" && f.tipo === "bajo")).toBe(true)
  })

  test("audit() detecta un filete demasiado brillante", () => {
    const roto = { ...THEMES[0]!.colors, line: "#FFFFFF" }
    expect(audit(roto).some((f) => f.rol === "line" && f.tipo === "alto")).toBe(true)
  })

  test("audit() mira también las familias de equipo", () => {
    const roto = { ...THEMES[0]!.colors, node: { ...THEMES[0]!.colors.node, other: "#111111" } }
    expect(audit(roto).some((f) => f.rol === "node.other")).toBe(true)
    expect(NODE_MIN).toBeGreaterThanOrEqual(3)
  })
})

describe("registro de temas", () => {
  test("el tema por defecto existe", () => {
    expect(findTheme(DEFAULT_THEME)).toBeDefined()
  })

  test("no hay nombres repetidos", () => {
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length)
  })

  test("hay al menos un tema claro", () => {
    // Un terminal de fondo blanco es un caso real, no un borde.
    expect(THEMES.some((t) => !t.dark)).toBe(true)
  })

  test("cada tema tiene las mismas claves que el de la casa", () => {
    // Una clave de menos sería `undefined` en el estilo y OpenTUI pintaría el
    // color por defecto del terminal, que es exactamente lo que el tema existe
    // para evitar.
    const esperadas = Object.keys(THEMES[0]!.colors).sort()
    const nodos = Object.keys(THEMES[0]!.colors.node).sort()
    for (const t of THEMES) {
      expect(Object.keys(t.colors).sort()).toEqual(esperadas)
      expect(Object.keys(t.colors.node).sort()).toEqual(nodos)
    }
  })
})
