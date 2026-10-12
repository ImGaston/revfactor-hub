"use client"

import { publishableKey, supabaseFetch } from "@/lib/supabase/keys"
import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    publishableKey(),
    { global: { fetch: supabaseFetch } }
  )
}
