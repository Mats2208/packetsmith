// La secuencia del título es puro string, y es de las que fallan feo: si el
// texto trae un ESC o un BEL, la secuencia se cierra antes de tiempo y la cola
// se imprime como texto suelto encima de la interfaz. Se ve como basura en
// pantalla y no se parece en nada a "el título quedó mal".
import { expect, test, describe } from "bun:test"
import { secuenciaProgreso, secuenciaTitulo } from "../src/tui/titulo.ts"

describe("secuenciaTitulo", () => {
  test("OSC 2 abierto y BEL al final", () => {
    expect(secuenciaTitulo("PacketSmith")).toBe("\x1b]2;PacketSmith\x07")
  })

  test("los controles del texto no cierran la secuencia", () => {
    const seq = secuenciaTitulo("Packet\x07Smith\x1b[31m")
    // Un solo ESC —el de apertura— y un solo BEL —el del cierre.
    expect([...seq].filter((c) => c === "\x1b")).toHaveLength(1)
    expect([...seq].filter((c) => c === "\x07")).toHaveLength(1)
    expect(seq).toBe("\x1b]2;Packet Smith [31m\x07")
  })

  test("el rombo y los acentos sobreviven", () => {
    // Se escribe en UTF-8 sin transformar nada: el ícono de mentira del
    // principio es un carácter como cualquier otro.
    expect(secuenciaTitulo("◆ PacketSmith · razonando")).toContain("◆ PacketSmith · razonando")
  })
})

describe("secuenciaProgreso", () => {
  // OSC 9;4 es lo que Windows Terminal dibuja sobre el ícono de la pestaña.
  // Errarle al estado no rompe nada visible: simplemente no late nunca, o —peor—
  // late para siempre y se le queda pegado a la barra de tareas.
  test("encendido pide el indeterminado, no un porcentaje inventado", () => {
    expect(secuenciaProgreso(true)).toBe("\x1b]9;4;3;0\x07")
  })

  test("apagado es el estado 0, que lo saca de la pestaña", () => {
    expect(secuenciaProgreso(false)).toBe("\x1b]9;4;0;0\x07")
  })
})
