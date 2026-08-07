// Lo que la app le escribe a la pestaña de la terminal: su título y su latido.
//
// La pestaña dice lo que dejó escrito el último programa que la tocó, y hay
// programas que escriben el suyo y no lo devuelven al salir —Claude Code deja
// "claude"—, así que PacketSmith corriendo se veía como otra cosa. El nombre lo
// tiene que poner la app: es la única que sabe qué está pasando ahí adentro.
//
// El ÍCONO de la pestaña no se puede tocar desde acá: en Windows Terminal viene
// del perfil, no del programa, y no hay secuencia que lo cambie. El rombo del
// principio es lo más cerca que se llega, y no es un adorno cualquiera — es el
// mismo que el panel de topología dibuja para un router.
//
// OpenTUI trae `renderer.setTerminalTitle()` y aun así esto escribe la secuencia
// a mano, por dos razones: el título hay que DEVOLVERLO al salir, y para
// entonces el renderer ya se destruyó; y una secuencia escrita acá se puede
// testear sin una terminal, mientras que la del renderer se arma del lado de
// Zig y hay que creerle. OpenTUI, por su cuenta, nunca toca el título — así que
// nadie pelea con nadie.
import { writeSync } from "node:fs"

/** El rombo del plano, haciendo de ícono donde no se puede poner uno de verdad. */
const MARCA = "◆"

/** Lo último que escribimos. Sin esto se reescribiría el título en cada frame. */
let ultimo: string | undefined

/** Si ya apilamos el título que había antes de arrancar, para devolverlo al salir. */
let apilado = false

/** Si el indicador de progreso está encendido. */
let progreso = false

/** Si ya dejamos puesta la limpieza de salida. Una sola vez, no una por llamada. */
let registrado = false

/**
 * La secuencia que pone el título. Exportada para poder testearla sin terminal.
 *
 * Es OSC 2 y no OSC 0 porque el 0 pisa además el "icon name", que es lo que
 * varios emuladores muestran con la ventana minimizada; con el 2 se cambia solo
 * lo que se ve en la pestaña. Cierra con BEL en vez de con ST porque es lo que
 * entienden todos, incluidos tmux y screen.
 */
export function secuenciaTitulo(texto: string): string {
  // Un ESC o un BEL adentro del texto CERRARÍAN la secuencia antes de tiempo y
  // el resto se imprimiría suelto en la pantalla. Hoy lo que entra acá lo arma
  // la app y no puede traerlos, pero un título es exactamente el lugar donde
  // mañana alguien mete el nombre del proyecto o del modelo.
  const limpio = texto.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim()
  return `\x1b]2;${limpio}\x07`
}

/**
 * Escribe al descriptor 1 y no por `process.stdout`.
 *
 * `writeSync` es sincrónico siempre; `process.stdout.write` a una TTY de Windows
 * es asincrónico, y una escritura asincrónica lanzada desde el handler de
 * `exit` no llega a salir nunca — que es justo donde se devuelve el título.
 */
function escribir(seq: string): void {
  if (!process.stdout.isTTY) return
  try {
    writeSync(1, seq)
  } catch {
    // Una terminal que se cerró mientras salíamos. No hay nada que informar: el
    // título de una pestaña que ya no existe no le importa a nadie.
  }
}

/**
 * Pone `◆ PacketSmith`, con el estado colgado si el agente está en algo.
 *
 * El estado va porque el dato que uno busca mirando la pestaña DESDE OTRA
 * pestaña es siempre el mismo: si ya terminó. En reposo no se cuelga nada, así
 * que el nombre a secas significa "listo" sin tener que leerlo.
 */
export function ponerTitulo(estado?: string): void {
  const texto = `${MARCA} PacketSmith${estado ? ` · ${estado}` : ""}`
  if (texto === ultimo) return
  ultimo = texto

  if (!apilado) {
    // CSI 22;2t apila el título actual; el 23;2t de abajo lo desapila. Las
    // terminales que no lo soportan ignoran la secuencia —no la imprimen—, y el
    // único costo de eso es que al salir la pestaña se queda con nuestro nombre
    // en vez de con el que tenía.
    escribir("\x1b[22;2t")
    apilado = true
    registrarSalida()
  }

  escribir(secuenciaTitulo(texto))
}

/**
 * La secuencia del indicador de progreso. Exportada para testearla igual.
 *
 * Es OSC 9;4, el protocolo que inventó ConEmu y que Windows Terminal dibuja
 * SOBRE EL ÍCONO de la pestaña y en el de la barra de tareas. Es lo más cerca
 * que un programa llega a tocar el ícono: la imagen no se puede cambiar por
 * secuencia en ninguna terminal, pero el estado sí.
 *
 * El estado `3` es "indeterminado" y late solo. Se eligió sobre el `1`, que
 * lleva porcentaje, porque un porcentaje acá sería inventado: nadie sabe cuánto
 * le falta a un agente. El `0` lo apaga.
 */
export function secuenciaProgreso(activo: boolean): string {
  return activo ? "\x1b]9;4;3;0\x07" : "\x1b]9;4;0;0\x07"
}

/**
 * Enciende o apaga el latido del ícono mientras el agente trabaja.
 *
 * Sirve para lo mismo que el estado colgado del título y por otra vía: con la
 * ventana minimizada o en otra pestaña, el ícono es lo único que se ve.
 */
export function ponerProgreso(activo: boolean): void {
  if (activo === progreso) return
  progreso = activo
  // Se registra la salida también acá: se puede terminar la sesión con el
  // agente todavía trabajando, y un progreso que quedó encendido se le pega a
  // la barra de tareas hasta que cierres la ventana.
  if (activo) registrarSalida()
  escribir(secuenciaProgreso(activo))
}

/** Cubre la salida por Ctrl+C y por `/exit`: las dos terminan en `exit`. */
function registrarSalida(): void {
  if (registrado) return
  registrado = true
  process.once("exit", limpiarPestana)
}

/** Devuelve la pestaña como estaba: su título de antes y sin progreso. */
export function limpiarPestana(): void {
  if (progreso) {
    progreso = false
    escribir(secuenciaProgreso(false))
  }
  if (!apilado) return
  apilado = false
  ultimo = undefined
  escribir("\x1b[23;2t")
}
