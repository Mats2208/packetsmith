// Los efectos de monitor CRT.
//
// El arquetipo de esta interfaz se llama "Tactical Telemetry / CRT" desde el
// primer día, y hasta ahora lo del CRT era una forma de hablar. OpenTUI trae el
// post-procesado hecho, así que son quince líneas.
//
// Van APAGADOS por defecto, y no es timidez: las scanlines bajan el contraste
// efectivo de todo lo que tapan, y este proyecto acaba de gastar un buen rato
// arreglando exactamente eso. Es carácter, no legibilidad — el que lo quiera lo
// enciende.
//
// Por lo mismo se eligieron los dos más suaves de los que hay, y con la mano
// liviana. `applyScanlines` tiene además una propiedad que lo hace el candidato
// obvio: solo toca el búfer de FONDO, así que el texto queda intacto.
import { applyScanlines, VignetteEffect, type CliRenderer, type OptimizedBuffer } from "@opentui/core"

/** Cuánto se nota. Más que esto y la barra de estado empieza a costar leerla. */
const FUERZA_SCANLINE = 0.12
const FUERZA_VINETA = 0.3

/** Las funciones que están puestas ahora, para poder sacar exactamente esas. */
let puestas: ((b: OptimizedBuffer, dt: number) => void)[] = []

/**
 * Enciende o apaga los efectos. Devuelve si quedaron encendidos.
 *
 * El renderer entra por parámetro porque solo se consigue desde un componente
 * (`useRenderer`) y esto no es uno.
 */
export function aplicarEfectos(renderer: CliRenderer, encender: boolean): boolean {
  // Se quitan de a una y no con `clearPostProcessFns()`: si algún día hay otra
  // cosa post-procesando, apagar los efectos no tiene por qué llevársela.
  for (const fn of puestas) renderer.removePostProcessFn(fn)
  puestas = []
  if (!encender) return false

  const vineta = new VignetteEffect(FUERZA_VINETA)
  puestas = [
    (buffer) => applyScanlines(buffer, FUERZA_SCANLINE),
    (buffer) => vineta.apply(buffer),
  ]
  for (const fn of puestas) renderer.addPostProcessFn(fn)
  return true
}
