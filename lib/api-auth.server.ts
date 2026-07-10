// Server-only API-key auth — uses the service-role admin client
import { createHash, randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"

export const API_SCOPES = ["leads:read"] as const
export type ApiScope = (typeof API_SCOPES)[number]

const KEY_PREFIX = "rvf_live_"
/** Chars of the plaintext token stored as `key_prefix` for identification. */
const PREFIX_LENGTH = KEY_PREFIX.length + 8
/** Skip the `last_used_at` write if the stored value is newer than this. */
const LAST_USED_THROTTLE_MS = 60_000

export type ApiKeyContext = {
  keyId: string
  scopes: string[]
}

export type VerifyResult =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; status: 401 | 403; error: string }

export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = KEY_PREFIX + randomBytes(32).toString("hex")
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_LENGTH),
    hash: hashApiKey(plaintext),
  }
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

export function hasScope(scopes: string[], needed: ApiScope): boolean {
  return scopes.includes(needed)
}

/**
 * Verify an `Authorization: Bearer <token>` header against `api_keys`.
 *
 * SHA-256, not bcrypt/argon2, on purpose: the token is 256 bits of uniform
 * randomness rather than a low-entropy password, so there is nothing to
 * brute-force, and a fast digest lets us resolve the key with one indexed
 * lookup per request. Because the lookup is equality on a 256-bit digest there
 * is no secret-dependent branch to time. If this is ever changed to fetch by
 * prefix and then compare, that comparison must use `crypto.timingSafeEqual`.
 */
export async function verifyApiKey(
  request: Request,
  requiredScope: ApiScope,
): Promise<VerifyResult> {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header" }
  }

  const token = header.slice("Bearer ".length).trim()
  if (!token) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header" }
  }

  const supabase = createAdminClient()
  const { data: key } = await supabase
    .from("api_keys")
    .select("id, scopes, last_used_at")
    .eq("key_hash", hashApiKey(token))
    .is("revoked_at", null)
    .maybeSingle()

  if (!key) {
    return { ok: false, status: 401, error: "Invalid API key" }
  }

  if (!hasScope(key.scopes, requiredScope)) {
    return { ok: false, status: 403, error: `API key is missing the ${requiredScope} scope` }
  }

  touchLastUsed(key.id, key.last_used_at)

  return { ok: true, context: { keyId: key.id, scopes: key.scopes } }
}

/** Fire-and-forget, throttled: never block the response on usage bookkeeping. */
function touchLastUsed(keyId: string, lastUsedAt: string | null): void {
  if (lastUsedAt && Date.now() - Date.parse(lastUsedAt) < LAST_USED_THROTTLE_MS) return

  void createAdminClient()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId)
    .then(({ error }) => {
      if (error) console.warn("[api-auth] last_used_at update failed:", error.message)
    })
}
