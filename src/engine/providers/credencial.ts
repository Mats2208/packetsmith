// Conseguir con qué autenticarse, sea key o sesión.
//
// Vive aparte de `auth.ts` porque `auth.ts` solo GUARDA y LEE; esto además
// renueva, que es otra responsabilidad y la única que puede hacer red.
//
// La renovación es la razón de que esto exista: un token de ChatGPT dura una
// hora. Sin renovarlo, la app anda hasta que dejás de mirarla y después falla
// con un 401 que parece "se rompió" cuando en realidad era "venció".
import { credencialGuardada, setOauth } from "../../auth.ts"
import { apiKey } from "../../auth.ts"
import type { Credencial, Plan } from "./catalog.ts"
import { refrescarTokens } from "./oauth-chatgpt.ts"

/** Margen antes del vencimiento. Un token que vence en 30s ya no sirve. */
const MARGEN_MS = 60_000

/**
 * La credencial lista para usar, renovada si hacía falta.
 *
 * `undefined` si no hay con qué: el motor traduce eso a un mensaje que dice
 * cómo conectarse, y NO a un 401 críptico del proveedor.
 */
export async function resolverCredencial(
  providerId: string,
  plan: Plan,
  path?: string,
): Promise<Credencial | undefined> {
  if (plan.auth !== "chatgpt") {
    const key = apiKey(providerId, plan.id, path)
    return key ? { token: key } : undefined
  }

  const g = credencialGuardada(providerId, path)
  if (g?.tipo !== "oauth" || !g.refresh) return undefined

  const vigente = g.access && (g.expires ?? 0) > Date.now() + MARGEN_MS
  if (vigente) {
    return { token: g.access!, ...(g.accountId ? { accountId: g.accountId } : {}) }
  }

  const t = await refrescarTokens(g.refresh)
  // El id de cuenta puede no venir en el refresco; se conserva el que había o
  // los pedidos siguientes salen sin la cabecera que ese endpoint exige.
  const accountId = t.accountId ?? g.accountId
  setOauth(providerId, { ...t, ...(accountId ? { accountId } : {}) }, g.plan ?? plan.id, path)
  return { token: t.access, ...(accountId ? { accountId } : {}) }
}
