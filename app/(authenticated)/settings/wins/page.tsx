import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { daysBetween } from "@/lib/wins"
import {
  getActiveRules,
  getLatestWinsRun,
  getRuleImpactSample,
  getRuleSetHistory,
} from "@/lib/wins-queries"

import { WinsRulesEditor } from "./wins-rules-editor"

export default async function WinsRulesSettingsPage() {
  const canView = await hasPermission("wins", "view")
  if (!canView) redirect("/settings/account")

  const supabase = await createClient()
  const [{ rules }, history, canPublish, run] = await Promise.all([
    getActiveRules(supabase),
    getRuleSetHistory(supabase),
    hasPermission("wins", "control"),
    getLatestWinsRun(supabase),
  ])

  // The impact preview re-evaluates the latest run's listings under proposed
  // thresholds. Without a run there is nothing to preview against, which the
  // editor states rather than silently showing zeroes.
  const stalenessDays = run
    ? daysBetween(run.as_of_date, new Date().toISOString().slice(0, 10))
    : 0
  const sample = run ? await getRuleImpactSample(supabase, run.id, stalenessDays) : []

  return (
    <WinsRulesEditor
      activeRules={rules}
      history={history}
      canPublish={canPublish}
      sample={sample}
      run={
        run
          ? {
              asOfDate: run.as_of_date,
              periodLabel: `${run.period_start.slice(0, 7)} → ${run.period_end.slice(0, 7)}`,
              candidateCount: run.candidate_count,
              rulesVersion: run.rules_version,
            }
          : null
      }
    />
  )
}
