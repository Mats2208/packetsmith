// Los temas.
//
// Arquetipo de la casa: Tactical Telemetry / CRT. Las reglas que lo definen
// —fondo casi-negro nunca #000000, UN acento para lo que exige atención, el
// verde de fósforo reservado al enlace con Packet Tracer— siguen valiendo, y
// cada tema propio las respeta. Los temas populares se incluyen porque un
// terminal es de quien lo mira, no del que lo escribió.
//
// Regla que no se negocia: **un tema que no pasa `audit()` no se publica.** Por
// eso las paletas conocidas están ADAPTADAS y no copiadas: se conserva el tono
// y la saturación del color original y se lo empuja en luminosidad hasta que
// cumple el mínimo de su rol. Donde eso desfiguraba el color, se oscureció el
// FONDO en vez de lavar el acento —es lo que se hizo con Nord, cuyo rojo
// auténtico da 3.05:1 sobre su propio fondo—, y donde ni eso alcanzó, está
// dicho en el comentario del tema.
import type { Palette, Theme } from "./palette.ts"

/** El de siempre, con los roles ya separados y el contraste corregido. */
const telemetry: Palette = {
  bg: "#0A0A0A", panel: "#101010", sunken: "#141414",
  fg: "#EAEAEA", dim: "#868686", faint: "#6B6B6B",
  line: "#333333", wire: "#626262",
  alert: "#EA3939", warn: "#D97706", live: "#4AF626", brand: "#38BDF8",
  shadow: "#3A3A3A",
  node: { router: "#EAEAEA", switch: "#9A9A9A", wireless: "#6B6B6B",
          cloud: "#6B6B6B", host: "#6B6B6B", other: "#626262" },
}

/** Ámbar de monitor viejo. El más cercano a una consola de los 80. */
const amber: Palette = {
  bg: "#0D0A06", panel: "#120E08", sunken: "#17120A",
  fg: "#FFCC66", dim: "#D9A441", faint: "#9A7430",
  line: "#403016", wire: "#7A5D29",
  alert: "#FF5F45", warn: "#FFD24A", live: "#7CE06A", brand: "#FFB000",
  shadow: "#4A3818",
  node: { router: "#FFCC66", switch: "#D9A441", wireless: "#9A7430",
          cloud: "#9A7430", host: "#8A682C", other: "#7A5D29" },
}

/** Fósforo verde. Acá el verde deja de ser exclusivo del enlace, y está bien:
 *  cuando todo es verde, el brillo es lo que distingue. */
const phosphor: Palette = {
  bg: "#040A05", panel: "#08100A", sunken: "#0C160E",
  fg: "#C9FFD2", dim: "#6FD98A", faint: "#4A9960",
  line: "#193927", wire: "#306F47",
  alert: "#FF5C5C", warn: "#FFD966", live: "#33FF66", brand: "#33FF99",
  shadow: "#1E4530",
  node: { router: "#C9FFD2", switch: "#6FD98A", wireless: "#4A9960",
          cloud: "#4A9960", host: "#458F58", other: "#306F47" },
}

/** Azul frío, de instrumental de laboratorio. */
const ice: Palette = {
  bg: "#070A0F", panel: "#0B1017", sunken: "#10161F",
  fg: "#E3EDF7", dim: "#93A9C2", faint: "#63788F",
  line: "#263447", wire: "#4D6583",
  alert: "#FF6B6B", warn: "#F2B441", live: "#5BE3A6", brand: "#5FB8FF",
  shadow: "#28374A",
  node: { router: "#E3EDF7", switch: "#B4C7DC", wireless: "#8496AC",
          cloud: "#8496AC", host: "#7387A0", other: "#5A6D85" },
}

/**
 * Contraste máximo. Es el ÚNICO tema con negro puro.
 *
 * El arquetipo prohíbe #000000 porque aplana y delata al terminal, y tiene
 * razón. Pero este tema existe para quien lee en una pantalla mala, con reflejo
 * o con poca vista, y ahí la legibilidad le gana a la estética. La regla se
 * rompe a propósito y una sola vez.
 */
const contrast: Palette = {
  bg: "#000000", panel: "#0A0A0A", sunken: "#151515",
  fg: "#FFFFFF", dim: "#D0D0D0", faint: "#A0A0A0",
  line: "#3C3C3C", wire: "#7A7A7A",
  alert: "#FF4B4B", warn: "#FFC33D", live: "#3DFF6E", brand: "#4DD2FF",
  shadow: "#4A4A4A",
  node: { router: "#FFFFFF", switch: "#D0D0D0", wireless: "#A8A8A8",
          cloud: "#A8A8A8", host: "#9A9A9A", other: "#7A7A7A" },
}

/** Claro, para terminales de fondo blanco. El único donde `fg` es el oscuro. */
const paper: Palette = {
  bg: "#FAFAF7", panel: "#F1F1EC", sunken: "#E6E6DF",
  fg: "#1A1A18", dim: "#4A4A45", faint: "#6E6E67",
  line: "#C7C7BE", wire: "#848479",
  alert: "#B3261E", warn: "#8A5A00", live: "#1E6E3C", brand: "#0B5CAD",
  shadow: "#C4C4BB",
  node: { router: "#1A1A18", switch: "#3D3D38", wireless: "#5C5C55",
          cloud: "#5C5C55", host: "#6E6E67", other: "#82827A" },
}

/** Catppuccin Mocha. Solo `fg`, `wire` y `other` necesitaron un empujón. */
const catppuccin: Palette = {
  bg: "#1E1E2E", panel: "#181825", sunken: "#313244",
  fg: "#E0E5F8", dim: "#A6ADC8", faint: "#7F849C",
  line: "#45475A", wire: "#787C95",
  alert: "#F38BA8", warn: "#FAB387", live: "#A6E3A1", brand: "#89B4FA",
  shadow: "#45475A",
  node: { router: "#E0E5F8", switch: "#B4BEFE", wireless: "#9399B2",
          cloud: "#9399B2", host: "#7F849C", other: "#777B92" },
}

/** Gruvbox dark. Su rojo (#FB4934) daba 3.82:1 y se aclaró a #FC6857. */
const gruvbox: Palette = {
  bg: "#1D2021", panel: "#282828", sunken: "#32302F",
  fg: "#EEE0BC", dim: "#BDAE93", faint: "#928374",
  line: "#484341", wire: "#85786D",
  alert: "#FC6857", warn: "#FABD2F", live: "#B8BB26", brand: "#83A598",
  shadow: "#504945",
  node: { router: "#EEE0BC", switch: "#D5C4A1", wireless: "#A89984",
          cloud: "#A89984", host: "#928374", other: "#84776B" },
}

/**
 * Nord, con el fondo un punto más profundo que el `nord0` original.
 *
 * Es el tema que peor se lleva con el contraste: su rojo sobre su propio fondo
 * da 2.46:1. Lavarlo hasta 4.5 lo volvía rosa, así que se oscureció el fondo
 * —que es lo que menos personalidad le saca— y aun así el rojo quedó más claro
 * que el auténtico. Es el precio de que los errores se lean.
 */
const nord: Palette = {
  bg: "#232730", panel: "#1E222A", sunken: "#2E3440",
  fg: "#ECEFF4", dim: "#D8DEE9", faint: "#A9B1C0",
  line: "#434C5E", wire: "#6F7D98",
  alert: "#CF8990", warn: "#EBCB8B", live: "#A3BE8C", brand: "#88C0D0",
  shadow: "#4C566A",
  node: { router: "#ECEFF4", switch: "#D8DEE9", wireless: "#A9B1C0",
          cloud: "#A9B1C0", host: "#98A2B3", other: "#858D9C" },
}

/** Tokyo Night. Pasó casi entero; solo `fg`, `wire` y `other` se corrigieron. */
const tokyoNight: Palette = {
  bg: "#1A1B26", panel: "#16161E", sunken: "#292E42",
  fg: "#D8DEF9", dim: "#A9B1D6", faint: "#787C99",
  line: "#3B4261", wire: "#6B75A2",
  alert: "#F7768E", warn: "#E0AF68", live: "#9ECE6A", brand: "#7AA2F7",
  shadow: "#3B4261",
  node: { router: "#D8DEF9", switch: "#B4F9F8", wireless: "#9AA5CE",
          cloud: "#9AA5CE", host: "#787C99", other: "#6B75A2" },
}

/** Dracula. Su rojo (#FF5555) daba 3.75:1 y se aclaró a #FF7676. */
const dracula: Palette = {
  bg: "#282A36", panel: "#21222C", sunken: "#343746",
  fg: "#F8F8F2", dim: "#D0D0C8", faint: "#8F91A0",
  line: "#44475A", wire: "#7280AD",
  alert: "#FF7676", warn: "#FFB86C", live: "#50FA7B", brand: "#8BE9FD",
  shadow: "#44475A",
  node: { router: "#F8F8F2", switch: "#BD93F9", wireless: "#A6A8B8",
          cloud: "#A6A8B8", host: "#8F91A0", other: "#7280AD" },
}

/** Rosé Pine. El que menos hubo que tocar: solo `wire` y `other`. */
const rosePine: Palette = {
  bg: "#191724", panel: "#1F1D2E", sunken: "#26233A",
  fg: "#E0DEF4", dim: "#C3C0D8", faint: "#908CAA",
  line: "#403D52", wire: "#706C89",
  alert: "#EB6F92", warn: "#F6C177", live: "#9CCFD8", brand: "#C4A7E7",
  shadow: "#403D52",
  node: { router: "#E0DEF4", switch: "#C4A7E7", wireless: "#9CCFD8",
          cloud: "#908CAA", host: "#908CAA", other: "#706C89" },
}

/**
 * Solarized dark, y el que más adaptación necesitó: SEIS roles.
 *
 * No es casualidad. Solarized se diseñó en 2011 optimizando relaciones entre
 * colores, no contraste contra el fondo, y sus cuatro acentos quedan entre
 * 2.8:1 y 4.1:1 sobre `base03`. Todos se aclararon. Sigue siendo Solarized de
 * tono; de luminosidad, no del todo.
 */
const solarized: Palette = {
  bg: "#002B36", panel: "#00252E", sunken: "#073642",
  fg: "#EEE8D5", dim: "#97A5A5", faint: "#839496",
  line: "#0C4959", wire: "#657E86",
  alert: "#E87775", warn: "#C29300", live: "#8EA300", brand: "#48A0DE",
  shadow: "#0E4B5A",
  node: { router: "#EEE8D5", switch: "#97A5A5", wireless: "#839496",
          cloud: "#839496", host: "#748C8E", other: "#657E86" },
}

export const THEMES: Theme[] = [
  { name: "telemetry", label: "el de la casa · CRT táctico", dark: true, colors: telemetry },
  { name: "amber", label: "ámbar de monitor viejo", dark: true, colors: amber },
  { name: "phosphor", label: "fósforo verde", dark: true, colors: phosphor },
  { name: "ice", label: "azul frío de laboratorio", dark: true, colors: ice },
  { name: "contrast", label: "contraste máximo", dark: true, colors: contrast },
  { name: "paper", label: "claro, para fondo blanco", dark: false, colors: paper },
  { name: "catppuccin", label: "Catppuccin Mocha", dark: true, colors: catppuccin },
  { name: "gruvbox", label: "Gruvbox dark", dark: true, colors: gruvbox },
  { name: "nord", label: "Nord", dark: true, colors: nord },
  { name: "tokyo-night", label: "Tokyo Night", dark: true, colors: tokyoNight },
  { name: "dracula", label: "Dracula", dark: true, colors: dracula },
  { name: "rose-pine", label: "Rosé Pine", dark: true, colors: rosePine },
  { name: "solarized", label: "Solarized dark", dark: true, colors: solarized },
]

export const DEFAULT_THEME = "ice"

export function findTheme(name: string): Theme | undefined {
  return THEMES.find((t) => t.name === name)
}
