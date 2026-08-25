import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  RevenueDataIssueRow,
  RevenuePropertyProfileRow,
  RevenueRecommendationRow,
  RevenueReviewRunRow,
  RevenueStrategyVersionRow,
} from "@/lib/revenue-manager/persistence"

export class RevenuePersistenceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RevenuePersistenceUnavailableError"
  }
}

export type RevenuePersistenceSnapshot = {
  listing: {
    id: string
    client_id: string
    name: string
    city: string | null
    state: string | null
  }
  profile: RevenuePropertyProfileRow | null
  strategy: RevenueStrategyVersionRow | null
  latestReview: RevenueReviewRunRow | null
  recommendations: RevenueRecommendationRow[]
  dataIssues: RevenueDataIssueRow[]
}

function queryError(scope: string, message: string): never {
  if (message.includes("revenue_") && message.includes("does not exist")) {
    throw new RevenuePersistenceUnavailableError(
      "Revenue Manager persistence is not applied to this database. Migration 075 remains pending review."
    )
  }
  throw new Error(`Failed to read ${scope}: ${message}`)
}

export async function getRevenuePersistenceSnapshot(
  supabase: SupabaseClient,
  listingId: string
): Promise<RevenuePersistenceSnapshot | null> {
  const listingResult = await supabase
    .from("listings")
    .select("id, client_id, name, city, state")
    .eq("id", listingId)
    .maybeSingle()

  if (listingResult.error) {
    queryError("Revenue Manager listing", listingResult.error.message)
  }
  if (!listingResult.data) return null

  const [
    profileResult,
    strategyResult,
    reviewResult,
    recommendationResult,
    issueResult,
  ] = await Promise.all([
    supabase
      .from("revenue_property_profiles")
      .select("*")
      .eq("listing_id", listingId)
      .eq("status", "current")
      .maybeSingle(),
    supabase
      .from("revenue_strategy_versions")
      .select("*")
      .eq("listing_id", listingId)
      .eq("status", "approved")
      .maybeSingle(),
    supabase
      .from("revenue_review_runs")
      .select("*")
      .eq("listing_id", listingId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("revenue_recommendations")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("revenue_data_issues")
      .select("*")
      .eq("listing_id", listingId)
      .in("status", ["open", "acknowledged"])
      .order("severity", { ascending: false })
      .order("updated_at", { ascending: false }),
  ])

  for (const [scope, result] of [
    ["current revenue profile", profileResult],
    ["approved revenue strategy", strategyResult],
    ["latest revenue review", reviewResult],
    ["revenue recommendations", recommendationResult],
    ["revenue data issues", issueResult],
  ] as const) {
    if (result.error) queryError(scope, result.error.message)
  }

  return {
    listing: listingResult.data as RevenuePersistenceSnapshot["listing"],
    profile: profileResult.data as RevenuePropertyProfileRow | null,
    strategy: strategyResult.data as RevenueStrategyVersionRow | null,
    latestReview: reviewResult.data as RevenueReviewRunRow | null,
    recommendations: (recommendationResult.data ??
      []) as RevenueRecommendationRow[],
    dataIssues: (issueResult.data ?? []) as RevenueDataIssueRow[],
  }
}
