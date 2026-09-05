import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  groupGhlOnboardingTeamReviewRows,
  type GhlOnboardingTeamReviewRow,
} from "@/lib/ghl-onboarding-v1/team-review"

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/permissions.server", () => ({
  hasPermission: mocks.hasPermission,
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { verifyGhlOnboardingTaskAction } from "@/app/(authenticated)/onboarding/v1/actions"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260904128000_ghl_onboarding_team_review.sql"
  ),
  "utf8"
)

const taskId = "00000000-0000-4000-8000-000000000001"
const updatedAt = "2026-09-04T16:00:00.000Z"

beforeEach(() => {
  mocks.hasPermission.mockReset().mockResolvedValue(true)
  mocks.rpc.mockReset().mockResolvedValue({ data: updatedAt, error: null })
  mocks.revalidatePath.mockReset()
})

describe("V1 team review action", () => {
  it("fails closed before database access without onboarding edit permission", async () => {
    mocks.hasPermission.mockResolvedValue(false)

    await expect(
      verifyGhlOnboardingTaskAction({
        taskId,
        expectedUpdatedAt: updatedAt,
        evidence: "Verified access.",
      })
    ).resolves.toEqual({
      error: "You do not have permission to verify onboarding tasks.",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("passes the reviewed task version and trimmed human evidence to the atomic RPC", async () => {
    await expect(
      verifyGhlOnboardingTaskAction({
        taskId,
        expectedUpdatedAt: updatedAt,
        evidence: "  Confirmed portal access with the assigned owner.  ",
      })
    ).resolves.toEqual({ success: true })

    expect(mocks.rpc).toHaveBeenCalledWith("verify_ghl_onboarding_task_v1", {
      p_task_id: taskId,
      p_expected_updated_at: updatedAt,
      p_evidence: "Confirmed portal access with the assigned owner.",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/onboarding/v1")
  })

  it("surfaces a stale mutation without claiming verification", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "onboarding_task_stale" },
    })

    await expect(
      verifyGhlOnboardingTaskAction({
        taskId,
        expectedUpdatedAt: updatedAt,
        evidence: "Verified.",
      })
    ).resolves.toEqual({
      error: "This task changed after you opened it. Reload before verifying.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects blank evidence before database access", async () => {
    await expect(
      verifyGhlOnboardingTaskAction({
        taskId,
        expectedUpdatedAt: updatedAt,
        evidence: "   ",
      })
    ).resolves.toEqual({
      error: "Add a verification note of up to 2,000 characters.",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe("V1 team review projection", () => {
  it("groups task rows without merging separate accepted runs for one client", () => {
    const row = {
      journey_id: "journey-1",
      run_id: "run-1",
      client_name: "Owner",
      property_name: "Lake House",
      property_street: "1 Lake Road",
      property_unit: null,
      property_city: "Lake City",
      property_region: "NY",
      property_postal_code: "10001",
      property_country: "US",
      property_status: "live",
      listing_url: "https://example.com/listing",
      target_launch_date: null,
      property_goal: "balanced",
      minimum_nightly_mode: "specified",
      minimum_nightly_value: 250,
      minimum_stay_mode: "specified",
      minimum_stay_nights: 3,
      cleaning_fee_mode: "guidance",
      cleaning_fee_value: null,
      operating_constraints: "No Sunday check-ins",
      software_status: null,
      pms_name: null,
      portal_status: "portal_invited",
      run_submitted_at: updatedAt,
      task_id: taskId,
      task_kind: "property",
      task_label: "Lake House",
      client_status: "submitted",
      team_status: "pending",
      owner_profile_id: null,
      owner_name: null,
      task_updated_at: updatedAt,
      verified_at: null,
      verified_by: null,
      verification_evidence: null,
    } satisfies GhlOnboardingTeamReviewRow

    const grouped = groupGhlOnboardingTeamReviewRows([
      row,
      { ...row, task_id: "task-2", task_label: "PriceLabs access" },
      { ...row, journey_id: "journey-2", run_id: "run-2", task_id: "task-3" },
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped[0].tasks).toHaveLength(2)
    expect(grouped[1].journeyId).toBe("journey-2")
  })

  it("limits reads to accepted V1 portal runs and an explicit safe projection", () => {
    expect(migration).toContain("j.submitted_snapshot is not null")
    expect(migration).toContain(
      "j.stage in ('portal_invited', 'portal_active')"
    )
    expect(migration).toContain("r.external_key = 'ghl-v1-' || j.id::text")
    expect(migration).toContain(
      "r.submitted_payload->>'version' = 'rf.onboarding.v1'"
    )
    expect(migration).toContain("t.team_status in ('pending', 'verified')")
    expect(migration).toContain(
      "t.task_key in ('pms', 'airbnb', 'pricelabs') or accepted_property.data is not null"
    )
    expect(migration).toContain("accepted_property.data#>>'{address,street}'")
    expect(migration).toContain("accepted_property.data#>>'{preferences,goal}'")
    expect(migration).toContain("'^https?://[^[:space:]]+$'")
    const returnShape = migration.slice(
      migration.indexOf(
        "create function public.list_ghl_onboarding_team_review_v1"
      ),
      migration.indexOf("create function public.verify_ghl_onboarding_task_v1")
    )
    expect(returnShape).not.toMatch(
      /returns table[\s\S]*\b(payload|contact_id|opportunity_id|assembly_client_id)\b/i
    )
  })

  it("enforces database permission, evidence, stale CAS, atomic audit, and immutability", () => {
    expect(migration).toContain(
      "public.has_permission('onboarding', 'view') is not true"
    )
    expect(migration).toContain(
      "public.has_permission('onboarding', 'edit') is not true"
    )
    expect(migration).toContain(
      "target_task.updated_at is distinct from p_expected_updated_at"
    )
    expect(migration).toContain("verification_evidence_required")
    expect(migration).toContain("atomic_verification_required")
    expect(migration).toContain("before insert or update or delete")
    expect(migration).toContain("new.run_id is distinct from old.run_id")
    expect(migration).toContain("new.task_key is distinct from old.task_key")
    expect(migration).toContain("ghl_onboarding_verification_immutable")
    expect(migration).toContain("btrim(p_evidence), next_updated_at")
    expect(
      migration.indexOf(
        "insert into public.ghl_onboarding_task_verifications_v1"
      )
    ).toBeLessThan(migration.indexOf("set team_status = 'verified'"))
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i)
  })
})
