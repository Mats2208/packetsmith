// El tema activo, y cómo lo lee el resto de la interfaz.
//
// `C` y `NODE` siguen siendo lo que eran —objetos con un color por clave— pero
// ahora cada clave es un GETTER que lee el tema en curso. Eso es lo que permite
// cambiar de tema en caliente sin tocar los ciento y pico de lugares que los
// usan: `C.fg` adentro de un JSX queda suscripto solo, porque Solid reevalúa el
// objeto de estilo cuando cambia una señal que se leyó al construirlo.
//
// Hay UNA trampa y cuesta cara: si alguien copia estos valores a una constante
// de módulo, esa constante congela el tema con el que arrancó la app y no se
// entera de ningún cambio. Pasaba con `TONE` en frame.tsx y con `INK` en
// chat.tsx; los dos son funciones ahora. Si vas a derivar colores, derivalos
// adentro del componente.
//
// Las reglas de la paleta —qué significa cada rol y cuánto contraste necesita—
// viven en `palette.ts`, y `themes.ts` tiene los temas. Acá solo está el
// interruptor.
import { createSignal } from "solid-js"
import type { NodeRole, Palette } from "./palette.ts"
import { DEFAULT_THEME, findTheme, THEMES } from "./themes.ts"

const inicial = findTheme(process.env.PACKETSMITH_THEME ?? DEFAULT_THEME)
  ?? findTheme(DEFAULT_THEME)!

const [activo, setActivo] = createSignal(inicial)

/** El tema en curso. Para quien necesite el objeto entero (nombre, claro/oscuro). */
export const theme = activo

/** Cambia el tema. Devuelve false si no existe, sin tocar nada. */
export function setTheme(name: string): boolean {
  const t = findTheme(name)
  if (!t) return false
  setActivo(t)
  return true
}

export { THEMES, DEFAULT_THEME }

/**
 * Arma un objeto de getters con las mismas claves que el original.
 *
 * Se enumeran las claves del tema por defecto y no se usa un Proxy pelado
 * porque un Proxy sin `ownKeys` deja `Object.keys()` en vacío, y eso rompe
 * silenciosamente a cualquiera que quiera recorrer la paleta. El test de temas
 * garantiza que todos tienen exactamente las mismas claves.
 */
function vivo<T extends Record<string, string>>(leer: () => T): T {
  const out = {} as T
  for (const k of Object.keys(leer()) as (keyof T)[]) {
    Object.defineProperty(out, k, { get: () => leer()[k], enumerable: true })
  }
  return out
}

type Colores = Omit<Palette, "node">

/**
 * La paleta, por rol.
 *
 *   · `fg` `dim` `faint` son texto, en ese orden de importancia.
 *   · `line` es SOLO cromo —bordes, filetes, la parte vacía de un medidor— y
 *     tiene permitido ser casi invisible justamente porque nunca lleva texto.
 *   · `wire` son los cables del plano, que son dato y no adorno.
 *   · `alert` `warn` `live` son estado; `brand` es identidad y nada más.
 */
export const C: Colores = vivo(() => {
  const { node: _node, ...resto } = activo().colors
  return resto
})

/** Un tono por familia de equipo, sin degradés ni medias tintas. */
export const NODE: Record<NodeRole, string> = vivo(() => activo().colors.node)

/** Framing ASCII. `[ TOPOLOGY ]` en vez de un título suelto. */
export const bracket = (s: string) => `[ ${s.toUpperCase()} ]`
