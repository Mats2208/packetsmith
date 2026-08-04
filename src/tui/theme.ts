// Paleta y símbolos. Arquetipo: Tactical Telemetry / CRT.
//
// Reglas que se respetan a rajatabla, porque son las que evitan que esto
// termine pareciendo cualquier otro TUI de agente:
//
//   · Fondo casi-negro, NUNCA #000000: el negro puro aplana y delata al
//     terminal. #0A0A0A deja el panel "encendido".
//   · UN solo color de acento (rojo aviación) y solo para lo que exige
//     atención. Si todo resalta, nada resalta.
//   · El verde de fósforo se reserva para UN indicador: el enlace con Packet
//     Tracer. Es el único dato binario que importa de un vistazo.
//   · Las etiquetas van en MAYÚSCULA con tracking; los datos, en minúscula.
//     El contraste de casing es lo que separa cronología de contenido sin
//     gastar una línea ni un borde.

export const C = {
  bg: "#0A0A0A",
  /** Texto principal — fósforo blanco, no blanco puro. */
  fg: "#EAEAEA",
  /** Metadata, unidades, todo lo secundario. */
  dim: "#6B6B6B",
  /** Estructura: bordes, separadores, reglas. */
  rule: "#2A2A2A",
  /** Acento único. Errores y solo errores. */
  alert: "#E61919",
  /** Ámbar de aviso. UN solo uso: la cuota cerca del tope. Es el único estado
   *  que no es ni normal ni error, y confundirlo con cualquiera de los dos
   *  costaría un turno cortado a la mitad. */
  warn: "#D97706",
  /** Fósforo verde. EXCLUSIVO del estado del enlace con PT. */
  live: "#4AF626",
  /** Quien habla: el operador. */
  operator: "#EAEAEA",
  /** Superficie hundida — bloques de código. */
  sunken: "#141414",
  /** Superficie levantada — el panel de telemetría. Lo separa del chat sin
   *  gastar un marco: la diferencia de fondo ya dice "esto es otra zona". */
  panel: "#101010",
  /** Reflejo del wordmark. Entre la regla y el texto apagado: tiene que
   *  leerse como fósforo, no como una segunda línea de texto. */
  shadow: "#3A3A3A",
} as const

/** Nodos de red. Un tono por familia, sin degradés ni medias tintas. */
export const NODE = {
  router: "#EAEAEA",
  switch: "#9A9A9A",
  wireless: "#6B6B6B",
  cloud: "#6B6B6B",
  host: "#6B6B6B",
  other: "#4A4A4A",
} as const

/** Framing ASCII. `[ TOPOLOGY ]` en vez de un título suelto. */
export const bracket = (s: string) => `[ ${s.toUpperCase()} ]`

/** Tracking mecánico: `TOPOLOGY` → `T O P O L O G Y`. Solo para etiquetas cortas. */
export const track = (s: string) => s.toUpperCase().split("").join(" ")
