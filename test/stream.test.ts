import { expect, test, describe } from "bun:test"
import { jsonLines, lines } from "../src/engine/stream.ts"

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!
}

/** Corta el texto en trozos de n bytes para simular chunks de red. */
function chunkedStream(text: string, n: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close()
      c.enqueue(bytes.slice(i, i + n))
      i += n
    },
  })
}

describe("lines", () => {
  test("reensambla objetos partidos entre chunks", async () => {
    // El caso que rompe un split ingenuo: los chunks no respetan los saltos de
    // línea, así que un JSON puede llegar cortado al medio.
    const text = '{"a":1}\n{"b":2}\n'
    const got: string[] = []
    for await (const l of lines(chunkedStream(text, 3))) got.push(l)
    expect(got).toEqual(['{"a":1}', '{"b":2}'])
  })

  test("emite la última línea aunque no tenga salto final", async () => {
    const got: string[] = []
    for await (const l of lines(streamOf('{"a":1}\n{"sin":"salto"}'))) got.push(l)
    expect(got).toHaveLength(2)
    expect(got[1]).toBe('{"sin":"salto"}')
  })

  test("descarta líneas en blanco", async () => {
    const got: string[] = []
    for await (const l of lines(streamOf('{"a":1}\n\n\n{"b":2}\n'))) got.push(l)
    expect(got).toHaveLength(2)
  })
})

describe("jsonLines", () => {
  test("saltea las líneas no-JSON pero avisa", async () => {
    // Los CLIs mezclan banners y avisos de actualización con su salida
    // estructurada. Tragárselas en silencio es cómo se pierde un evento sin
    // que nadie sepa por qué.
    const skipped: string[] = []
    const got: unknown[] = []
    const text = '{"ok":1}\nbanner de actualización\n{"ok":2}\n'
    for await (const o of jsonLines(streamOf(text), (l) => skipped.push(l))) got.push(o)

    expect(got).toHaveLength(2)
    expect(skipped).toEqual(["banner de actualización"])
  })
})
