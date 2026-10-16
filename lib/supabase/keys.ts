/** Client-safe public config. API keys never replace signed-in user JWTs. */
export function publishableKey() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key || key.startsWith("sb_secret_")) throw new Error("Public Supabase configuration is unavailable")
  return key
}
export const supabaseFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  if (/^Bearer sb_(?:secret|publishable)_/i.test(headers.get("authorization") ?? "")) headers.delete("authorization")
  return fetch(input, { ...init, headers })
}
