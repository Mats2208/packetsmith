// Los roles de color, y el contrato de contraste que cada uno tiene que cumplir.
//
// La paleta vieja tenía catorce claves planas y un problema: `rule` hacía dos
// trabajos incompatibles. Como filete —un borde, un separador, la parte vacía
// de un medidor— puede permitirse ser casi invisible, y estaba bien. Pero
// también pintaba TEXTO: el modelo de cada equipo, los nombres de interfaz, la
// línea de ⏱, los títulos de sección, las instrucciones de la bienvenida. A
// 1.38:1 eso no se lee en ningún monitor.
//
// De ahí sale la única idea de este archivo: un rol dice para qué sirve un
// color Y cuánto contraste necesita. Separar `line` (cromo) de `faint` (texto
// terciario) es lo que evita que el defecto se herede en cada tema nuevo.

import { worst } from "./contrast.ts"

/** Los tres fondos sobre los que la app dibuja. */
export interface Surfaces {
  /** Fondo general. Nunca negro puro: el negro puro aplana y delata al terminal. */
  bg: string
  /** Panel de telemetría — un punto distinto para separarlo sin gastar un marco. */
  panel: string
  /** Superficie hundida: bloques de código y badges de tools. */
  sunken: string
}

export interface Palette extends Surfaces {
  /** Texto principal. */
  fg: string
  /** Secundario: modelo del equipo, interfaces, títulos de sección, línea de ⏱. */
  dim: string
  /** Terciario: guías del árbol, atajos, pistas. Se lee, aunque no se busque. */
  faint: string
  /** SOLO cromo: bordes, filetes, parte vacía de los medidores. Nunca texto. */
  line: string
  /** Cables del plano. No es cromo: un cable es DATO. */
  wire: string
  /** Errores, y solo errores. */
  alert: string
  /** El único estado que no es ni normal ni error: la cuota cerca del tope. */
  warn: string
  /** Fósforo. EXCLUSIVO del enlace con Packet Tracer. */
  live: string
  /** Identidad: el wordmark, el nombre en la cabecera, los títulos. */
  brand: string
  /** Reflejo del wordmark. Entre el filete y el texto apagado. */
  shadow: string
  /** Un tono por familia de equipo, sin degradés ni medias tintas. */
  node: Record<NodeRole, string>
}

export type NodeRole = "router" | "switch" | "wireless" | "cloud" | "host" | "other"

export interface Theme {
  name: string
  /** Se muestra en `/theme`. Dice de dónde sale la paleta, no cómo se ve. */
  label: string
  dark: boolean
  colors: Palette
}

/**
 * Cuánto contraste exige cada rol, y contra qué.
 *
 * `on: "text"` mide contra los TRES fondos, porque un color de texto puede
 * aparecer en cualquiera de ellos y solo sirve si se lee en todos. Mirar nada
 * más que el fondo general es cómo se cuela un tono que desaparece adentro del
 * panel.
 *
 * `on: "chrome"` mide contra el fondo y el panel: los filetes no se dibujan
 * dentro de un bloque hundido.
 *
 * El `max` de `line` y `shadow` no es un detalle: un filete demasiado brillante
 * deja de leerse como estructura y compite con el texto. El contrato va en las
 * dos direcciones.
 */
export const ROLES = {
  fg: { min: 10, on: "text" },
  dim: { min: 5, on: "text" },
  faint: { min: 3, on: "text" },
  wire: { min: 3, on: "text" },
  alert: { min: 4.5, on: "text" },
  warn: { min: 4.5, on: "text" },
  live: { min: 4.5, on: "text" },
  brand: { min: 4.5, on: "text" },
  line: { min: 1.5, max: 4.5, on: "chrome" },
  shadow: { min: 1.5, max: 5, on: "chrome" },
} as const satisfies Record<string, { min: number; max?: number; on: "text" | "chrome" }>

/** Los equipos del árbol y del plano tienen que distinguirse del fondo. */
export const NODE_MIN = 3

export type RoleName = keyof typeof ROLES

/** Un rol que no cumple su contrato, con el número que lo delata. */
export interface Falla {
  rol: string
  ratio: number
  limite: number
  tipo: "bajo" | "alto"
}

/**
 * Audita un tema contra el contrato. Vacío = pasa.
 *
 * Es lo que convierte "contraste real" en algo verificable en vez de una
 * intención: un tema que no pasa esto no se publica.
 */
export function audit(colors: Palette): Falla[] {
  const fallas: Falla[] = []
  const texto = [colors.bg, colors.panel, colors.sunken]
  const cromo = [colors.bg, colors.panel]

  for (const [rol, regla] of Object.entries(ROLES)) {
    const ratio = worst(colors[rol as RoleName], regla.on === "text" ? texto : cromo)
    if (ratio < regla.min) fallas.push({ rol, ratio, limite: regla.min, tipo: "bajo" })
    const max = (regla as { max?: number }).max
    if (max !== undefined && ratio > max) fallas.push({ rol, ratio, limite: max, tipo: "alto" })
  }

  for (const [familia, color] of Object.entries(colors.node)) {
    const ratio = worst(color, texto)
    if (ratio < NODE_MIN) {
      fallas.push({ rol: `node.${familia}`, ratio, limite: NODE_MIN, tipo: "bajo" })
    }
  }

  return fallas
}
