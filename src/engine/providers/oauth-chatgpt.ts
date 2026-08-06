// Entrar con la suscripción de ChatGPT, sin API key.
//
// Un plan Plus/Pro no tiene key: tiene una sesión. OpenAI expone para eso el
// mismo login que usa Codex, y opencode lo implementa en dos sabores —uno que
// abre el navegador contra un `localhost:1455`, y uno de DISPOSITIVO donde te
// dan un código para tipear en otra pantalla.
//
// Acá va solo el de dispositivo, a propósito: es el único que funciona en una
// terminal por SSH, en WSL, o con el navegador en otra máquina. Levantar un
// servidor HTTP en un puerto fijo para recibir un redirect es exactamente el
// tipo de cosa que esta app no debería hacer si hay una alternativa.
//
// El token de acceso VENCE —una hora— y viene con uno de refresco. Eso obliga a
// que la credencial se pueda reescribir sola, y es la razón de que `auth.json`
// guarde objetos y no cadenas.
//
// Nada de esto se imprime ni se loguea. El código de usuario SÍ se muestra,
// porque hay que tipearlo, pero no sirve para nada sin la cuenta.

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
/** Margen sobre el intervalo que pide el servidor, para no golpear de más. */
const MARGEN_MS = 3_000

export interface Tokens {
  access: string
  refresh: string
  /** Epoch en milisegundos. */
  expires: number
  accountId?: string
}

export interface LoginPendiente {
  /** A dónde tiene que ir la persona. */
  url: string
  /** El código que tiene que tipear ahí. */
  codigo: string
  /** Se resuelve cuando autoriza. Rechaza si falla o si se aborta. */
  esperar(signal?: AbortSignal): Promise<Tokens>
}

function cabeceras(tipo: string) {
  return { "content-type": tipo, "user-agent": "packetsmith" }
}

/**
 * Arranca el login y devuelve el código enseguida.
 *
 * Devolver antes de esperar es lo que permite mostrar el código mientras el
 * sondeo corre por atrás: si esto esperara, la pantalla quedaría muda los
 * treinta segundos que tarda alguien en abrir el navegador.
 */
export async function iniciarLogin(): Promise<LoginPendiente> {
  const res = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: cabeceras("application/json"),
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`no se pudo iniciar el login de ChatGPT (HTTP ${res.status})`)

  const d = await res.json() as { device_auth_id: string; user_code: string; interval?: string }
  const intervalo = Math.max(Number.parseInt(String(d.interval ?? "5")) || 5, 1) * 1000

  return {
    url: `${ISSUER}/codex/device`,
    codigo: d.user_code,
    async esperar(signal?: AbortSignal) {
      // Mientras no autorice, el servidor contesta 403/404. Cualquier otro
      // código es un fallo de verdad y corta: seguir sondeando contra un 500
      // es golpear a alguien que ya dijo que no puede.
      for (;;) {
        signal?.throwIfAborted()
        const r = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
          method: "POST",
          headers: cabeceras("application/json"),
          body: JSON.stringify({ device_auth_id: d.device_auth_id, user_code: d.user_code }),
          ...(signal ? { signal } : {}),
        })

        if (r.ok) {
          const data = await r.json() as { authorization_code: string; code_verifier: string }
          return canjear(data.authorization_code, data.code_verifier)
        }
        if (r.status !== 403 && r.status !== 404) {
          throw new Error(`el login de ChatGPT falló (HTTP ${r.status})`)
        }
        await new Promise((ok) => setTimeout(ok, intervalo + MARGEN_MS))
      }
    },
  }
}

/** Cambia el código autorizado por los tokens de verdad. */
async function canjear(code: string, verifier: string): Promise<Tokens> {
  const r = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: cabeceras("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  })
  if (!r.ok) throw new Error(`el canje de tokens falló (HTTP ${r.status})`)
  return desdeRespuesta(await r.json())
}

/** Renueva el acceso con el token de refresco. */
export async function refrescarTokens(refresh: string): Promise<Tokens> {
  const r = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: cabeceras("application/x-www-form-urlencoded"),
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID }).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`no se pudo renovar la sesión de ChatGPT (HTTP ${r.status}) — probá \`/connect\``)
  const t = desdeRespuesta(await r.json())
  // Algunos refrescos no devuelven uno nuevo: se conserva el que había, o la
  // próxima renovación se queda sin con qué.
  return { ...t, refresh: t.refresh || refresh }
}

function desdeRespuesta(j: any): Tokens {
  return {
    access: String(j.access_token ?? ""),
    refresh: String(j.refresh_token ?? ""),
    expires: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    ...(cuentaDe(j) ? { accountId: cuentaDe(j) } : {}),
  }
}

/**
 * De qué cuenta es la sesión.
 *
 * Va como cabecera en cada pedido, y sale de los claims del JWT. Se leen SOLO
 * los campos de cuenta: no se valida la firma ni hace falta — no confiamos en
 * el token, lo repetimos.
 */
function cuentaDe(j: { id_token?: string; access_token?: string }): string | undefined {
  for (const token of [j.id_token, j.access_token]) {
    if (!token) continue
    const parte = token.split(".")[1]
    if (!parte) continue
    try {
      const c = JSON.parse(Buffer.from(parte, "base64url").toString()) as {
        chatgpt_account_id?: string
        organizations?: { id?: string }[]
        "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
      }
      const id = c.chatgpt_account_id
        ?? c["https://api.openai.com/auth"]?.chatgpt_account_id
        ?? c.organizations?.[0]?.id
      if (id) return id
    } catch { /* un token sin claims legibles no es un error fatal */ }
  }
  return undefined
}
