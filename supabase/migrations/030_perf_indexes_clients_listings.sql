-- Performance indexes for /clients and /listings list views.
-- Scope: ONLY sort/filter paths for these two routes. Other perf work
-- (listing_id lookup, onboarding_progress, etc.) lives in its own migration.

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_listings_name ON listings(name);
CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks(client_id, status);
