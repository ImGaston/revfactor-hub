# PriceLabs service-only Edge Function

Deployed handler migrated from the shared project's legacy API key. Set `REVFACTOR_PRICELABS_SECRET_KEY` to the separate `revfactor-pricelabs-edge` secret. Callers send it on `apikey`; reject all other callers before any provider or database call. Deploy with `--no-verify-jwt` because a new API key is not a JWT. The handler performs its own constant-time digest comparison; never disable it. Supabase database calls use the secret on `apikey` only. Existing PriceLabs provider variables remain unchanged. Failed provider/database responses suppress raw diagnostics.

This function reads PriceLabs and upserts only the Supabase reservation mirror; it changes no vendor pricing, stay rules or reservations. External/manual callers must switch to the Edge-specific key before legacy API keys are disabled.
