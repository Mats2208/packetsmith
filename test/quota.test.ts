// El porcentaje de plan consumido no viene en el stream: hay que pedírselo a
// Anthropic. Todo lo que se puede verificar sin red está acá; lo único que
// queda afuera son las dos funciones con I/O.
import { expect, test, describe } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseQuota, parseToken, QuotaCache, readToken, type Fetched } from "../src/engine/quota.ts"
import { pctColor } from "../src/tui/app.tsx"
import { C } from "../src/tui/theme.ts"

describe("parseToken", () => {
  test("saca el token del JSON de credenciales", () => {
    expect(parseToken('{"claudeAiOauth":{"accessToken":"sk-ant-abc"}}')).toBe("sk-ant-abc")
  })

  test("un archivo roto o sin sesión no rompe nada", () => {
    // Pasa de verdad: el archivo existe con otra forma, o no hay login. La app
    // tiene que seguir andando sin el medidor, no caerse.
    expect(parseToken("no soy json")).toBeUndefined()
    expect(parseToken("{}")).toBeUndefined()
    expect(parseToken('{"claudeAiOauth":{"accessToken":""}}')).toBeUndefined()
    expect(parseToken('{"claudeAiOauth":{"accessToken":123}}')).toBeUndefined()
  })
})

describe("readToken", () => {
  // Solo la rama del archivo: la del Keychain abre un diálogo del sistema y no
  // es algo que un test tenga derecho a disparar.
  const home = (contents?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "packetsmith-"))
    if (contents !== undefined) {
      mkdirSync(join(dir, ".claude"))
      writeFileSync(join(dir, ".claude", ".credentials.json"), contents)
    }
    return dir
  }

  test("lee el archivo de credenciales cuando está", async () => {
    const dir = home('{"claudeAiOauth":{"accessToken":"sk-ant-file"}}')
    expect(await readToken(dir, "linux")).toBe("sk-ant-file")
  })

  test("sin archivo y sin Keychain no hay token, y no es un error", () => {
    // No haber iniciado sesión es un estado normal: la app anda igual, sin el
    // medidor.
    expect(readToken(home(), "linux")).resolves.toBeUndefined()
  })
})

describe("parseQuota", () => {
  test("lee el porcentaje USADO de cada ventana", () => {
    expect(parseQuota({
      five_hour: { utilization: 62.4, resets_at: 1 },
      seven_day: { utilization: 21 },
    })).toEqual({ session: 62.4, weekly: 21 })
  })

  test("una sola ventana alcanza", () => {
    expect(parseQuota({ five_hour: { utilization: 5 } })).toEqual({ session: 5 })
  })

  test("una respuesta sin ninguna ventana no inventa un cero", () => {
    // Un medidor en cero que en realidad es "no sé" es peor que no mostrarlo.
    expect(parseQuota({})).toBeUndefined()
    expect(parseQuota({ five_hour: {} })).toBeUndefined()
    expect(parseQuota(null)).toBeUndefined()
    expect(parseQuota("error")).toBeUndefined()
  })
})

describe("QuotaCache", () => {
  const ok = (session: number): Fetched => ({ ok: true, quota: { session } })
  const err: Fetched = { ok: false, rateLimited: false }
  const limited: Fetched = { ok: false, rateLimited: true }

  test("sin ningún dato bueno todavía, un fallo no muestra nada", () => {
    expect(new QuotaCache().get(0, () => err)).toBeUndefined()
  })

  test("un fallo devuelve el último dato bueno, no un hueco", () => {
    // Sin esto el medidor DESAPARECÍA justo cuando más importa: con la cuota
    // casi agotada es cuando más se consulta y cuando el endpoint más falla.
    const c = new QuotaCache()
    expect(c.get(0, () => ok(60))).toEqual({ session: 60 })
    expect(c.get(1000, () => err)).toEqual({ session: 60 })
  })

  test("después de un 429 no se vuelve a la red hasta que pase el backoff", () => {
    // Insistirle a un rate limit solo lo alarga.
    const c = new QuotaCache(60_000)
    c.get(0, () => ok(60))
    expect(c.get(1000, () => limited)).toEqual({ session: 60 })

    let intentos = 0
    const contar = (): Fetched => { intentos++; return ok(70) }

    c.get(30_000, contar)
    expect(intentos).toBe(0)

    // Pasado el backoff se vuelve a intentar y el dato se actualiza.
    expect(c.get(61_001, contar)).toEqual({ session: 70 })
    expect(intentos).toBe(1)
  })
})

describe("pctColor", () => {
  test("el color aparece recién cuando hay algo que decidir", () => {
    // En 80 todavía te da para el turno que ibas a hacer; en 95 conviene
    // guardar y esperar el reinicio. Debajo de eso no hay decisión que tomar.
    expect(pctColor(12)).toBe(C.dim)
    expect(pctColor(79)).toBe(C.dim)
    expect(pctColor(80)).toBe(C.warn)
    expect(pctColor(94)).toBe(C.warn)
    expect(pctColor(95)).toBe(C.alert)
    expect(pctColor(100)).toBe(C.alert)
  })
})
