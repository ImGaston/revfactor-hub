import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  groupGhlOnboardingTeamReviewRows,
  type GhlOnboardingTeamReviewRow,
} from "@/lib/ghl-onboarding-v1/team-review"
import { GhlOnboardingTeamReview } from "./team-review"

export default async function GhlOnboardingTeamReviewPage() {
  if (!(await hasPermission("onboarding", "view"))) redirect("/")

  const supabase = await createClient()
  const [{ data, error }, canVerify] = await Promise.all([
    supabase.rpc("list_ghl_onboarding_team_review_v1"),
    hasPermission("onboarding", "edit"),
  ])

  if (error)
    throw new Error("The V1 onboarding review queue could not be loaded")

  return (
    <GhlOnboardingTeamReview
      runs={groupGhlOnboardingTeamReviewRows(
        (data ?? []) as GhlOnboardingTeamReviewRow[]
      )}
      canVerify={canVerify}
    />
  )
}
