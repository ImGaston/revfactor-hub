# Market Signals migration history

Event Intelligence collection, scoring, reviews, UI and the market-map endpoint moved to [revfactor-rm](https://github.com/federzimer/revfactor-rm). Future Market Signals SQL lives in `revfactor-rm/db/`.

Keep every applied migration file here unchanged. Hub and RM share the existing Supabase database; this retirement does not drop, rename, recreate or modify any table, policy or function. Keep `market_signals` in Hub's permission catalog so administrators can manage the shared RLS grants.

See the RM [migration record](https://github.com/federzimer/revfactor-rm/blob/main/docs/event-intelligence-migration.md) for approved SQL and cutover sequencing.
