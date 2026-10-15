import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  fetchPriceLabsListings,
  isPriceLabsConfigured,
  type PriceLabsListing,
} from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { runListingSetupCheck } from "@/lib/listing-setup-check.server"
import { captureDailySnapshots, runOutcomeCheckpoints } from "@/lib/listing-outcomes.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /v1/listings (20s per attempt, one retry on timeout/5xx) must finish by
// this point so the chained steps still get their turn.
const LISTINGS_FETCH_BUDGET_MS = 35_000
// The setup check stops starting new listings after this point.
const SETUP_CHECK_BUDGET_MS = 38_000
// Checkpoint reviews (AI summaries) stop starting new ones after this point.
const OUTCOMES_BUDGET_MS = 40_000

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Unknown error"

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isPriceLabsConfigured()) {
    return NextResponse.json(
      { error: "PRICELABS_API_KEY not configured" },
      { status: 500 }
    )
  }

  const startedAt = Date.now()
  const supabase = createAdminClient()

  // The route owns the one GET /v1/listings call so the setup check can reuse
  // it. only_syncing_listings=false: the sync and the setup check both need
  // push-off listings too.
  // (Typed with `as` because they are assigned inside the closure, which
  // control-flow narrowing doesn't see.)
  let allPriceLabsListings = undefined as PriceLabsListing[] | undefined
  let listingsFetchError = null as string | null
  const fetchListings = async () => {
    try {
      allPriceLabsListings = await fetchPriceLabsListings(false, {
        deadline: startedAt + LISTINGS_FETCH_BUDGET_MS,
      })
      return allPriceLabsListings
    } catch (err) {
      listingsFetchError = errorMessage(err)
      throw err
    }
  }

  // A failed sync no longer skips the chained steps: each runs on its own,
  // and the sync error is returned with a non-200 status so it stays visible.
  let sync: Awaited<ReturnType<typeof syncPriceLabsData>> | null = null
  let syncError: string | null = null
  try {
    sync = await syncPriceLabsData(supabase, { fetchListings })
  } catch (err) {
    console.error("PriceLabs sync error:", err)
    syncError = errorMessage(err)
  }

  // Listing revenue setup: confirm the decided PriceLabs settings (or flag
  // drift) right after the sync. Few listings carry setup rows, so this is a
  // handful of requests; it never blocks the later steps for long. It needs
  // PriceLabs data, so it is skipped when the listings request itself failed
  // (a third attempt would only eat the budget). If the sync failed before
  // fetching (e.g. a database read), the check fetches the listings itself.
  let setupCheck:
    | Awaited<ReturnType<typeof runListingSetupCheck>>
    | { skipped: true; reason: string }
    | { error: string }
    | null = null
  if (listingsFetchError) {
    setupCheck = {
      skipped: true,
      reason: `PriceLabs listings unavailable: ${listingsFetchError}`,
    }
  } else {
    try {
      setupCheck = await runListingSetupCheck(supabase, {
        deadline: startedAt + SETUP_CHECK_BUDGET_MS,
        allPriceLabsListings,
      })
      // The per-setting details stay out of the cron response.
      setupCheck = { ...setupCheck, details: [] }
    } catch (err) {
      console.error("Listing setup check (chained) error:", err)
      setupCheck = { error: errorMessage(err) }
    }
  }

  // Listing outcomes: store today's PriceLabs market numbers (pace vs market
  // needs history the pl_* columns overwrite) and save due day-7/14/30/60/90
  // checkpoint reviews. Both are no-ops until the outcomes migration exists.
  // Snapshots only take listings synced today, so after a failed sync they
  // capture nothing; checkpoints read reservations and stored snapshots, so
  // they still run (and run after the capture to see today's). Each step
  // fails on its own.
  let snapshots:
    | Awaited<ReturnType<typeof captureDailySnapshots>>
    | { error: string }
  try {
    snapshots = await captureDailySnapshots(supabase)
  } catch (err) {
    console.error("Listing outcome snapshots (chained) error:", err)
    snapshots = { error: errorMessage(err) }
  }
  let checkpoints:
    | Awaited<ReturnType<typeof runOutcomeCheckpoints>>
    | { error: string }
  try {
    checkpoints = await runOutcomeCheckpoints(supabase, {
      deadline: startedAt + OUTCOMES_BUDGET_MS,
    })
  } catch (err) {
    console.error("Listing outcome checkpoints (chained) error:", err)
    checkpoints = { error: errorMessage(err) }
  }
  const outcomes = { snapshots, checkpoints }

  if (!sync) {
    return NextResponse.json(
      {
        error: `PriceLabs sync failed: ${syncError}`,
        setupCheck,
        outcomes,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    message: `Synced ${sync.synced} listings from PriceLabs`,
    ...sync,
    setupCheck,
    outcomes,
  })
}
