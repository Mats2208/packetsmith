// Lectura de NDJSON según llega. Es el port streaming de `spawnCollect` +
// `jsonlLines` de hyprdesk/cli/adapters/shared.mjs: allá se juntaba todo el
// stdout y se parseaba al final, acá hay que emitir línea por línea o el panel
// de topología no puede reaccionar mientras el agente trabaja.

/**
 * Parte un stream de bytes en líneas completas.
 *
 * El corte de los chunks NO respeta los saltos de línea: un objeto JSON puede
 * llegar partido entre dos chunks, y el último puede venir sin `\n` final. Por
 * eso hay un buffer y por eso se emite la cola al cerrar.
 */
export async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.trim()) yield line
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) yield buffer
}

/**
 * Igual que `lines`, pero devuelve objetos ya parseados.
 *
 * Las líneas que no son JSON se saltan: los CLIs mezclan banners, warnings y
 * avisos de actualización con su salida estructurada. `onSkip` existe para que
 * el que llama pueda enterarse — tragarse una línea en silencio es cómo se
 * pierde un evento sin que nadie sepa por qué.
 */
export async function* jsonLines(
  stream: ReadableStream<Uint8Array>,
  onSkip?: (line: string) => void,
): AsyncGenerator<unknown> {
  for await (const line of lines(stream)) {
    try {
      yield JSON.parse(line)
    } catch {
      onSkip?.(line)
    }
  }
}
