// Que cambiar de tema REPINTE, no solo que cambie una señal.
//
// Es el supuesto que sostiene todo `/theme`: `C.fg` es un getter que lee el
// tema en curso, y Solid tiene que volver a evaluar el objeto de estilo cuando
// ese getter cambia. Si no lo hiciera, el tema cambiaría en memoria y la
// pantalla seguiría igual — que es exactamente el bug que tenían `TONE` e `INK`
// por ser constantes de módulo.
import { expect, test, describe, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { Canvas } from "../src/tui/canvas.tsx"
import { C, setTheme, theme, DEFAULT_THEME } from "../src/tui/theme.ts"
import { findTheme } from "../src/tui/themes.ts"
import type { Topology } from "../src/topology/model.ts"

const TOPO: Topology = {
  devices: [
    { name: "R1", model: "2911", x: 200, y: 90, ports: [{ name: "Gi0/1", ip: "10.0.0.1/24", linked: true }] },
    { name: "SW1", model: "2960-24TT", x: 200, y: 230, ports: [{ name: "Gi0/1", linked: true }] },
  ],
  links: [{ a: { device: "R1", port: "Gi0/1" }, b: { device: "SW1", port: "Gi0/1" }, wireless: false }],
}

afterEach(() => setTheme(DEFAULT_THEME))

/** Los colores de fondo y de frente que aparecen en un frame ya renderizado. */
async function tonos(setup: Awaited<ReturnType<typeof testRender>>): Promise<Set<string>> {
  await setup.renderOnce()
  const out = new Set<string>()
  for (const l of setup.captureSpans().lines) {
    for (const s of l.spans) { out.add(String(s.fg)); out.add(String(s.bg)) }
  }
  return out
}

/**
 * Componente rojo del fondo de la primera celda, 0..255.
 *
 * Se lee del buffer y no del `toString()`: OpenTUI devuelve
 * `rgba(0.95, 0.95, 0.93, 1.00)` en flotantes normalizados, y comparar contra
 * un hex ahí falla aunque el color sea el correcto.
 */
async function brilloDelFondo(setup: Awaited<ReturnType<typeof testRender>>): Promise<number> {
  await setup.renderOnce()
  const bg = setup.captureSpans().lines[0]!.spans[0]!.bg as unknown as { buffer: ArrayLike<number> }
  return bg.buffer[0]!
}

describe("cambio de tema en caliente", () => {
  test("repinta lo que ya estaba en pantalla", async () => {
    const setup = await testRender(() => Canvas({ topology: TOPO, live: true }), { width: 46, height: 20 })
    const antes = await tonos(setup)

    expect(setTheme("amber")).toBe(true)
    const despues = await tonos(setup)

    // No alcanza con que cambie ALGO: tienen que ser paletas distintas de
    // verdad, no un tono compartido de casualidad.
    expect([...despues].filter((t) => !antes.has(t)).length).toBeGreaterThan(3)
  })

  test("el tema claro invierte el fondo de verdad", async () => {
    // La prueba más difícil de fingir: si el repintado no llegara al
    // `backgroundColor` del panel, `paper` se vería con el fondo oscuro del
    // tema anterior. Se mide el brillo del fondo, no su nombre.
    const setup = await testRender(() => Canvas({ topology: TOPO }), { width: 46, height: 20 })

    setTheme("telemetry")
    expect(await brilloDelFondo(setup)).toBeLessThan(40)

    setTheme("paper")
    expect(await brilloDelFondo(setup)).toBeGreaterThan(200)
  })

  test("un tema que no existe no rompe ni cambia nada", () => {
    const previo = theme().name
    expect(setTheme("no-existe")).toBe(false)
    expect(theme().name).toBe(previo)
  })

  test("C sigue las claves del tema activo", () => {
    setTheme("gruvbox")
    expect(C.fg).toBe(findTheme("gruvbox")!.colors.fg)
    setTheme("nord")
    expect(C.fg).toBe(findTheme("nord")!.colors.fg)
  })

  test("C se puede recorrer, no es un Proxy ciego", () => {
    // Un Proxy pelado deja `Object.keys()` en vacío y rompe en silencio a
    // cualquiera que quiera listar la paleta.
    expect(Object.keys(C)).toContain("faint")
    expect(Object.keys(C).length).toBeGreaterThan(10)
  })
})
