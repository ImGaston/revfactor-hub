export type GhlOnboardingTeamReviewRow = {
  journey_id: string
  run_id: string
  client_name: string
  property_name: string | null
  property_street: string | null
  property_unit: string | null
  property_city: string | null
  property_region: string | null
  property_postal_code: string | null
  property_country: string | null
  property_status: "live" | "pre_launch" | null
  listing_url: string | null
  target_launch_date: string | null
  property_goal: "revenue" | "occupancy" | "balanced" | "guidance" | null
  minimum_nightly_mode: "specified" | "guidance" | "none" | null
  minimum_nightly_value: number | null
  minimum_stay_mode: "specified" | "guidance" | "none" | null
  minimum_stay_nights: number | null
  cleaning_fee_mode: "specified" | "guidance" | null
  cleaning_fee_value: number | null
  operating_constraints: string | null
  software_status: "done" | "need_help" | "not_applicable" | null
  pms_name: string | null
  portal_status: "portal_invited" | "portal_active"
  run_submitted_at: string | null
  task_id: string
  task_kind: "property" | "software"
  task_label: string
  client_status: "not_started" | "in_progress" | "submitted"
  team_status: "pending" | "verified"
  owner_profile_id: string | null
  owner_name: string | null
  task_updated_at: string
  verified_at: string | null
  verified_by: string | null
  verification_evidence: string | null
}

export type GhlOnboardingTeamReviewRun = {
  journeyId: string
  runId: string
  clientName: string
  portalStatus: "portal_invited" | "portal_active"
  submittedAt: string | null
  tasks: GhlOnboardingTeamReviewRow[]
}

export function groupGhlOnboardingTeamReviewRows(
  rows: GhlOnboardingTeamReviewRow[]
): GhlOnboardingTeamReviewRun[] {
  const runs = new Map<string, GhlOnboardingTeamReviewRun>()
  for (const row of rows) {
    const existing = runs.get(row.run_id)
    if (existing) {
      existing.tasks.push(row)
      continue
    }
    runs.set(row.run_id, {
      journeyId: row.journey_id,
      runId: row.run_id,
      clientName: row.client_name,
      portalStatus: row.portal_status,
      submittedAt: row.run_submitted_at,
      tasks: [row],
    })
  }
  return [...runs.values()]
}
