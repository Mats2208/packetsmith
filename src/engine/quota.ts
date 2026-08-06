// Cuánto del plan llevás consumido.
//
// El stream del CLI trae la ventana, su estado y la hora de reinicio, pero NO
// el porcentaje. Ese vive detrás de un endpoint de Anthropic que pide el token
// de OAuth — el mismo que el CLI ya guardó cuando iniciaste sesión.
//
// Sobre el token: se lee, se manda a api.anthropic.com y nunca se guarda, se
// imprime ni se loguea. En macOS vive en el Keychain, y leerlo dispara el
// diálogo de permiso del sistema la primera vez: ese diálogo ES el
// consentimiento, y si lo negás la app sigue andando sin el medidor.
//
// Todo lo que se puede testear sin red está separado: parseo, caché y backoff
// son puros; lo único con I/O son `readToken` y `fetchQuota`.

/** Porcentaje USADO de cada ventana, 0..100. */
export interface Quota {
  session?: number
  weekly?: number
}

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage"

/**
 * Nombre del ítem del Keychain donde Claude Code deja el token en macOS.
 *
 * Se puede pisar por entorno porque es lo único de acá que puede cambiar entre
 * versiones del CLI, y si cambia no hay forma de adivinarlo desde adentro.
 */
const KEYCHAIN_ITEM = process.env.PACKETSMITH_KEYCHAIN_ITEM || "Claude Code-credentials"

/** `claudeAiOauth.accessToken` del JSON de credenciales. */
export function parseToken(raw: string): string | undefined {
  try {
    const token = JSON.parse(raw)?.claudeAiOauth?.accessToken
    return typeof token === "string" && token ? token : undefined
  } catch {
    return undefined
  }
}

/**
 * El token de la sesión de Claude Code, si está a mano.
 *
 * Se prueba el archivo PRIMERO aunque en macOS casi nunca esté: leerlo no
 * cuesta nada ni pide permiso, mientras que tocar el Keychain abre un diálogo
 * del sistema. Molestar con un diálogo antes de haber agotado la opción barata
 * sería maleducado.
 */
export async function readToken(home: string, platform = process.platform): Promise<string | undefined> {
  const file = Bun.file(`${home}/.claude/.credentials.json`)
  if (await file.exists()) {
    const token = parseToken(await file.text())
    if (token) return token
  }

  if (platform !== "darwin") return undefined

  const proc = Bun.spawn(["security", "find-generic-password", "-s", KEYCHAIN_ITEM, "-w"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  if ((await proc.exited) !== 0) return undefined
  return parseToken((await new Response(proc.stdout).text()).trim())
}

/**
 * Lee los porcentajes de la respuesta del endpoint.
 *
 * `utilization` es el porcentaje USADO —no el que queda—, y la ventana se
 * identifica por el nombre de la clave, no por una duración.
 */
export function parseQuota(body: unknown): Quota | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const v = body as Record<string, any>
  const pct = (k: string) => {
    const n = Number(v[k]?.utilization)
    return Number.isFinite(n) ? n : undefined
  }

  const quota: Quota = {}
  const session = pct("five_hour")
  const weekly = pct("seven_day")
  if (session !== undefined) quota.session = session
  if (weekly !== undefined) quota.weekly = weekly

  return session === undefined && weekly === undefined ? undefined : quota
}

/** Qué pasó al pedir el dato. El 429 se distingue porque arranca el backoff. */
export type Fetched =
  | { ok: true; quota: Quota }
  | { ok: false; rateLimited: boolean }

/**
 * Caché con backoff.
 *
 * El endpoint contesta 429 bajo carga, y sin caché el chip DESAPARECÍA justo
 * cuando más importa —con la cuota casi agotada, que es cuando más se consulta.
 * Ante cualquier fallo se devuelve el último dato bueno; después de un 429 ni
 * siquiera se vuelve a la red hasta que pase el backoff, porque insistirle a un
 * rate limit solo lo alarga.
 *
 * Es puro: `now` y `fetch` entran por parámetro, así que se testea sin red.
 */
export class QuotaCache {
  private last?: Quota
  private backoffUntil = 0

  constructor(private readonly backoffMs = 5 * 60_000) {}

  get(now: number, fetch: () => Fetched): Quota | undefined {
    if (now < this.backoffUntil) return this.last

    const result = fetch()
    if (result.ok) {
      this.backoffUntil = 0
      this.last = result.quota
      return result.quota
    }
    if (result.rateLimited) this.backoffUntil = now + this.backoffMs
    return this.last
  }
}

/** Pide el dato al endpoint. Lo único con red. */
export async function fetchQuota(token: string): Promise<Fetched> {
  try {
    const res = await fetch(ENDPOINT, {
      headers: {
        authorization: `Bearer ${token}`,
        // El endpoint gatea por estos dos: sin ellos contesta 403.
        "anthropic-beta": "oauth-2025-04-20",
        "user-agent": "claude-code/2.1.0",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 429) return { ok: false, rateLimited: true }
    if (!res.ok) return { ok: false, rateLimited: false }

    const quota = parseQuota(await res.json())
    return quota ? { ok: true, quota } : { ok: false, rateLimited: false }
  } catch {
    return { ok: false, rateLimited: false }
  }
}

/** Cada cuánto se vuelve a preguntar. La cuota no se mueve rápido. */
const POLL_MS = 5 * 60_000

/**
 * Consulta la cuota cada tanto y avisa cuando cambia.
 *
 * Devuelve la función para cortar. Si no hay token —no iniciaste sesión, o
 * negaste el permiso del Keychain— no vuelve a intentar: reintentar solo
 * repetiría el diálogo del sistema, que es lo último que uno quiere.
 */
export function pollQuota(
  home: string,
  onQuota: (q: Quota) => void,
  /** `pedir` entra por parámetro por lo mismo que `fetch` en `QuotaCache`: que
   *  el ciclo se pueda testear sin red. */
  opts: { pollMs?: number; pedir?: (token: string) => Promise<Fetched> } = {},
): () => void {
  const cache = new QuotaCache()
  const pedir = opts.pedir ?? fetchQuota
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    const token = await readToken(home)
    if (!token || stopped) return

    const result = await pedir(token)
    const quota = cache.get(Date.now(), () => result)
    if (stopped) return
    if (quota) onQuota(quota)

    // El `stopped` de arriba no es de más: si se corta MIENTRAS el pedido está
    // en vuelo, el `clearTimeout` de `stop()` no encuentra nada que limpiar
    // —todavía no hay timer— y este `setTimeout` armaba uno que ya nadie iba a
    // cancelar. Un timer pendiente mantiene vivo el event loop, así que la app
    // tardaba hasta cinco minutos en terminar de cerrarse después de salir.
    timer = setTimeout(tick, opts.pollMs ?? POLL_MS)
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
