// Contraste, medido.
//
// Existe porque "se lee bien" no es una opinión que se pueda sostener a ojo
// sobre un fondo casi-negro: la paleta original tenía texto informativo —el
// modelo de cada equipo, los nombres de interfaz, la línea de ⏱— dibujado a
// 1.38:1, o sea invisible en cualquier monitor que no fuera el del autor.
//
// OpenTUI no trae nada de esto: no hay ratio de contraste, ni luminancia, ni
// mezcla de colores. Son treinta líneas y evitan una dependencia.
//
// La fórmula es la de WCAG 2.x. Se eligió esa y no una perceptualmente más
// moderna (APCA, OKLCH) por una razón práctica: es la que tiene umbrales que
// todo el mundo conoce y puede verificar con cualquier herramienta de la web.

/** `#0A0A0A` → `[10, 10, 10]`. Acepta con o sin `#`, y la forma corta de 3. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Luminancia relativa, 0..1. */
export function luminance(hex: string): number {
  const lineal = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb(hex)
  return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b)
}

/**
 * Ratio de contraste entre dos colores, de 1:1 (idénticos) a 21:1 (blanco
 * sobre negro). El orden no importa.
 */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * El PEOR contraste de un color contra varias superficies.
 *
 * La app dibuja sobre tres fondos —el general, el panel de topología y los
 * bloques hundidos— y un color solo sirve si se lee en los tres. Mirar solo el
 * fondo principal es cómo se cuela un tono que desaparece dentro del panel.
 */
export function worst(color: string, fondos: readonly string[]): number {
  return Math.min(...fondos.map((f) => contrast(color, f)))
}
