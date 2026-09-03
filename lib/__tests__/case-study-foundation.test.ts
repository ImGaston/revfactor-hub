import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { writeCaseStudyArtifacts } from "@/lib/case-studies/artifacts.server"
import { parseCaseStudyCliArgs } from "@/lib/case-studies/cli"
import {
  CASE_STUDY_WORKFLOW_VERSION,
  EXPECTED_REVFACTOR_PROJECT_REF,
  caseStudySelectionSchema,
  reportMetricSchema,
  type CaseStudySourceInventory,
} from "@/lib/case-studies/contracts"
import {
  analyzeCaseStudyFoundation,
  canonicalJson,
  firstCompleteManagedMonth,
  lastCompleteMonth,
} from "@/lib/case-studies/domain"
import {
  assertExpectedProject,
  createReadOnlyCaseStudyClient,
  readAllPages,
  validateReportRunInventory,
} from "@/lib/case-studies/repository.server"

const ids = {
  listing: "00000000-0000-4000-8000-000000000001",
  listing2: "00000000-0000-4000-8000-000000000002",
  listing3: "00000000-0000-4000-8000-000000000007",
  client: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  onboarding: "00000000-0000-4000-8000-000000000005",
  roster: "00000000-0000-4000-8000-000000000006",
}

function fixture(): CaseStudySourceInventory {
  const periods = ["2026-01-01", "2026-02-01", "2026-03-01"]
  return {
    workflowVersion: CASE_STUDY_WORKFLOW_VERSION,
    projectRef: EXPECTED_REVFACTOR_PROJECT_REF,
    asOf: "2026-04-30",
    expectedReportTemplateId: "tpl",
    selection: null,
    reportRun: {
      id: ids.run,
      template_id: "tpl",
      status: "completed",
      completed_at: "2026-04-29T12:00:00Z",
      listing_count: 1,
      metric_row_count: 3,
      unresolved_count: 0,
      report_currency: "USD",
      error_reason: null,
    },
    listings: [
      {
        id: ids.listing,
        name: "=Internal test listing",
        status: "active",
        listing_id: "pl-1",
        client_id: ids.client,
        created_at: "2024-01-01T00:00:00Z",
        initial_setup_date: "2025-04-01",
        adjustment_confirmed_date: null,
        deactivated_date: null,
      },
    ],
    clients: [
      {
        id: ids.client,
        name: "Internal Client",
        status: "active",
        onboarding_date: "2025-04-01",
      },
    ],
    setupAdjustments: [],
    onboardingRuns: [
      {
        id: ids.onboarding,
        client_id: ids.client,
        status: "live",
        started_at: "2025-03-01T00:00:00Z",
        live_at: "2025-04-01T00:00:00Z",
        created_at: "2025-03-01T00:00:00Z",
      },
    ],
    onboardingRunListings: [
      {
        id: ids.roster,
        run_id: ids.onboarding,
        hub_listing_id: ids.listing,
        is_live: true,
        launch_month: 1,
        launch_year: 2020,
        target_launch_month: null,
        target_launch_year: null,
        created_at: "2025-03-01T00:00:00Z",
      },
    ],
    reportListings: [
      {
        listing_id: "pl-1",
        listing_name: "Source listing",
        hub_listing_id: ids.listing,
        hub_client_id: ids.client,
        report_run_id: ids.run,
        updated_at: "2026-04-29T12:00:00Z",
      },
    ],
    reportMetrics: periods.map((period, index) => ({
      id: `00000000-0000-4000-8000-00000000001${index}`,
      report_run_id: ids.run,
      listing_id: "pl-1",
      period,
      rental_revenue: 10_000,
      rental_revenue_ly: 6_000,
      rental_adr: 200,
      rental_adr_ly: 160,
      market_adr: 180,
      rental_revpar: 120,
      rental_revpar_ly: 80,
      market_revpar: 100,
      market_revpar_ly: 80,
      revpar_index: 120,
      adjusted_occupancy_pct: 60,
      adjusted_occupancy_ly_pct: 50,
      market_occupancy_pct: 55,
      market_occupancy_ly_pct: 50,
      median_booking_window: 30,
      median_booking_window_ly: 28,
      market_median_booking_window: 25,
      market_median_booking_window_ly: 24,
    })),
  }
}

const temporaryDirectories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("case-study evidence rules", () => {
  it("requires an explicit valid as-of date and output", () => {
    expect(() => parseCaseStudyCliArgs(["--output", "out"])).toThrow("--as-of")
    expect(() =>
      parseCaseStudyCliArgs([
        "--as-of",
        "2026-02-31",
        "--output",
        "out",
        "--template-id",
        "tpl",
      ])
    ).toThrow("valid YYYY-MM-DD")
    expect(() =>
      parseCaseStudyCliArgs(["--as-of", "2026-02-28", "--template-id", "tpl"])
    ).toThrow("--output")
    expect(() =>
      parseCaseStudyCliArgs(["--as-of", "2026-02-28", "--output", "out"])
    ).toThrow("--template-id")
    expect(
      parseCaseStudyCliArgs([
        "--as-of",
        "2026-02-28",
        "--output",
        "out",
        "--template-id",
        "tpl",
      ])
    ).toMatchObject({
      asOf: "2026-02-28",
      output: path.resolve("out"),
      templateId: "tpl",
    })
  })

  it("excludes partial takeover and current months", () => {
    expect(firstCompleteManagedMonth("2026-01-15")).toBe("2026-02-01")
    expect(firstCompleteManagedMonth("2026-01-01")).toBe("2026-01-01")
    expect(lastCompleteMonth("2026-04-30")).toBe("2026-03-01")
  })

  it("qualifies three supported inherited months using final LY and market adjustment", () => {
    const result = analyzeCaseStudyFoundation(fixture())
    const candidate = result.candidates[0]
    expect(candidate.state).toBe("Quantitatively supported")
    expect(candidate.supportedManagedMonthCount).toBe(3)
    expect(candidate.monthly[0].priorYearAttribution).toBe("before_revfactor")
    expect(candidate.monthly[0].listingRevparYoyPct).toBe(50)
    expect(candidate.monthly[0].marketRevparYoyPct).toBe(25)
    expect(candidate.monthly[0].marketAdjustedRevparLiftPp).toBe(25)
    expect(candidate.rawMetricRowCount).toBe(3)
    expect(
      candidate.periods.find((period) => period.label === "first_3")
    ).toMatchObject({
      available: false,
      monthCount: 0,
    })
    expect(result.counts).toMatchObject({ analyzed: 1, blocked: 0, skipped: 0 })
  })

  it("does not label a RevFactor-managed prior year as a baseline", () => {
    const input = fixture()
    input.listings[0].initial_setup_date = "2024-01-01"
    const candidate = analyzeCaseStudyFoundation(input).candidates[0]
    expect(candidate.state).toBe("Missing baseline")
    expect(
      candidate.monthly.every(
        (month) => month.priorYearAttribution === "revfactor_managed"
      )
    ).toBe(true)
    expect(
      candidate.monthly.every((month) => month.rentalRevenueLy === null)
    ).toBe(true)
    expect(
      candidate.monthly.every((month) => month.marketRevparLy === 80)
    ).toBe(true)
    expect(
      candidate.monthly.every((month) => month.marketRevparYoyPct === 25)
    ).toBe(true)
  })

  it("starts an assisted launch in the month after launch and uses market-only evidence", () => {
    const input = fixture()
    input.asOf = "2026-05-02"
    input.reportRun.completed_at = "2026-05-01T12:00:00Z"
    input.listings[0].initial_setup_date = "2026-01-01"
    input.onboardingRuns[0].live_at = "2026-01-01T00:00:00Z"
    input.onboardingRunListings[0].is_live = false
    input.onboardingRunListings[0].target_launch_month = 1
    input.onboardingRunListings[0].target_launch_year = 2026
    input.reportMetrics.push({
      ...input.reportMetrics[2],
      id: "00000000-0000-4000-8000-000000000020",
      period: "2026-04-01",
    })
    input.reportRun.metric_row_count = 4
    const candidate = analyzeCaseStudyFoundation(input).candidates[0]
    expect(candidate.caseType).toBe("revfactor_assisted_launch")
    expect(candidate.state).toBe("Quantitatively supported")
    expect(candidate.comparableMonthCount).toBe(0)
    expect(candidate.monthly.map((month) => month.period)).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ])
    expect(
      candidate.monthly.every((month) => month.rentalRevenueLy === null)
    ).toBe(true)
  })

  it("fails closed for stale data, small bases, extreme values, and mapping conflicts", () => {
    const input = fixture()
    input.asOf = "2026-05-10"
    input.reportMetrics[0].rental_revenue_ly = 100
    input.reportMetrics[1].rental_revpar = 1_000
    input.reportListings[0].hub_listing_id = ids.listing2
    const candidate = analyzeCaseStudyFoundation(input).candidates[0]
    expect(candidate.state).toBe("Discovered")
    expect(candidate.rawMetricRowCount).toBe(3)
    expect(candidate.supportedManagedMonthCount).toBe(2)
    expect(candidate.qaFlags).toEqual(
      expect.arrayContaining([
        "stale_source",
        "small_ly_revenue_base",
        "extreme_listing_revpar_yoy",
        "report_listing_id_mismatch",
      ])
    )
    expect(candidate.monthly[0].listingRevparYoyPct).toBeNull()
  })

  it("requires unique exact selection IDs and isolates the pilot", () => {
    const input = fixture()
    input.listings.push(
      {
        ...input.listings[0],
        id: ids.listing2,
        name: "Pilot blocked two",
        listing_id: null,
      },
      {
        ...input.listings[0],
        id: ids.listing3,
        name: "Pilot blocked three",
        listing_id: null,
      }
    )
    input.selection = {
      version: "v1",
      listingIds: [ids.listing, ids.listing2, ids.listing3],
      rationale: "Three-listing pilot subset",
    }
    expect(
      caseStudySelectionSchema.parse(input.selection).listingIds
    ).toHaveLength(3)
    expect(analyzeCaseStudyFoundation(input).counts.selectedListings).toBe(3)
    input.selection.listingIds = [
      ids.listing,
      ids.listing2,
      "00000000-0000-4000-8000-000000000099",
    ]
    expect(() => analyzeCaseStudyFoundation(input)).toThrow(
      "missing or non-RevFactor"
    )
  })

  it("uses medium start evidence only for an exact live/completed onboarding run", () => {
    const input = fixture()
    input.listings[0].initial_setup_date = null
    input.onboardingRuns[0].status = "draft"
    const candidate = analyzeCaseStudyFoundation(input).candidates[0]
    expect(candidate.managementStartConfidence).toBe("low")
    expect(candidate.managementStartSource).toBe("listings.created_at")
    expect(candidate.qaFlags).toContain("onboarding_run_not_live_or_completed")
  })

  it("only makes first-period summaries available from exact consecutive initial coverage", () => {
    const input = fixture()
    input.listings[0].initial_setup_date = "2026-01-01"
    const firstThree = analyzeCaseStudyFoundation(
      input
    ).candidates[0].periods.find((period) => period.label === "first_3")
    expect(firstThree).toMatchObject({ available: true, monthCount: 3 })
  })

  it("retains market decline and resilience evidence without a listing LY claim", () => {
    const input = fixture()
    input.listings[0].initial_setup_date = "2024-01-01"
    for (const metric of input.reportMetrics) {
      metric.market_revpar = 70
      metric.market_revpar_ly = 80
      metric.revpar_index = (120 / 70) * 100
    }
    const candidate = analyzeCaseStudyFoundation(input).candidates[0]
    expect(
      candidate.monthly.every((month) => month.rentalRevenueLy === null)
    ).toBe(true)
    expect(candidate.monthly[0].marketRevparYoyPct).toBe(-12.5)
    expect(
      candidate.periods.find((period) => period.label === "all_supported")
    ).toMatchObject({ marketDeclined: true, marketResilience: true })
  })

  it("rejects an unexpected template and non-month-start metric period", () => {
    const input = fixture()
    input.expectedReportTemplateId = "reviewed-other-template"
    expect(() => analyzeCaseStudyFoundation(input)).toThrow(
      "reviewed template ID"
    )
    expect(() =>
      reportMetricSchema.parse({
        ...fixture().reportMetrics[0],
        period: "2026-01-02",
      })
    ).toThrow("first day")
  })

  it("blocks one incomplete listing without stopping the rest of the portfolio", () => {
    const input = fixture()
    input.listings.push({
      ...input.listings[0],
      id: ids.listing2,
      name: "Incomplete evidence listing",
      listing_id: null,
    })
    input.reportRun.listing_count = 2
    const result = analyzeCaseStudyFoundation(input)
    expect(result.counts).toMatchObject({
      selectedListings: 2,
      analyzed: 1,
      blocked: 1,
    })
    expect(
      result.candidates.find(
        (candidate) => candidate.hubListingId === ids.listing2
      )?.qaFlags
    ).toContain("missing_pricelabs_listing_id")
  })

  it("is deterministic for exact replay", () => {
    expect(canonicalJson(analyzeCaseStudyFoundation(fixture()))).toBe(
      canonicalJson(analyzeCaseStudyFoundation(fixture()))
    )
  })
})

describe("read-only repository", () => {
  it("pins the exact production project and rejects a wrong target", () => {
    expect(() => assertExpectedProject("https://other.supabase.co")).toThrow(
      "Refusing"
    )
    expect(() =>
      assertExpectedProject(
        `https://${EXPECTED_REVFACTOR_PROJECT_REF}.supabase.co`
      )
    ).not.toThrow()
  })

  it("rejects non-GET transport methods before network access", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      `https://${EXPECTED_REVFACTOR_PROJECT_REF}.supabase.co`
    )
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key")
    const network = vi.fn()
    vi.stubGlobal("fetch", network)
    const client = createReadOnlyCaseStudyClient()
    const result = await client.from("listings").insert({ name: "no" })
    expect(result.error?.message).toContain("rejected POST")
    expect(network).not.toHaveBeenCalled()
  })

  it("requires exact bounded pagination and rejects duplicate identities", async () => {
    const rows = await readAllPages(
      "test",
      z.object({ id: z.string() }),
      async () => ({
        data: [{ id: "one" }],
        error: null,
        count: 1,
      }),
      (row) => row.id
    )
    expect(rows).toEqual([{ id: "one" }])
    await expect(
      readAllPages(
        "test",
        z.object({ id: z.string() }),
        async () => ({
          data: [{ id: "one" }, { id: "one" }],
          error: null,
          count: 2,
        }),
        (row) => row.id
      )
    ).rejects.toThrow("duplicate identity")
  })

  it("reconciles listing/metric counts and refuses unresolved or partial runs", () => {
    const input = fixture()
    expect(() =>
      validateReportRunInventory(
        input.reportRun,
        input.reportListings,
        input.reportMetrics
      )
    ).not.toThrow()
    input.reportRun.unresolved_count = 1
    expect(() =>
      validateReportRunInventory(
        input.reportRun,
        input.reportListings,
        input.reportMetrics
      )
    ).toThrow("unresolved or partial")
    input.reportRun.unresolved_count = 0
    input.reportRun.listing_count = 2
    expect(() =>
      validateReportRunInventory(
        input.reportRun,
        input.reportListings,
        input.reportMetrics
      )
    ).toThrow("declared 2 listings")
  })

  it("contains no provider mutation builder in the repository implementation", async () => {
    const source = await readFile(
      path.resolve("lib/case-studies/repository.server.ts"),
      "utf8"
    )
    for (const method of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(source).not.toContain(method)
    }
  })
})

describe("deterministic artifacts", () => {
  it("writes deterministic artifacts, neutralizes CSV formulas, and refuses changed replay", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "case-study-test-"))
    temporaryDirectories.push(directory)
    const result = analyzeCaseStudyFoundation(fixture())
    const first = await writeCaseStudyArtifacts(directory, result)
    const second = await writeCaseStudyArtifacts(directory, result)
    expect(second).toEqual(first)
    expect(
      await readFile(path.join(directory, "case-study-candidates.csv"), "utf8")
    ).toContain("'=Internal test listing")
    const manifest = JSON.parse(
      await readFile(path.join(directory, "source-manifest.json"), "utf8")
    ) as { dataClassification: Record<string, unknown> }
    expect(manifest.dataClassification).toMatchObject({
      classification: "restricted_internal_pii",
      containsClientAndListingPII: true,
      publicDistributionAllowed: false,
      publicIdentityApproved: false,
    })
    await writeFile(
      path.join(directory, "case-study-foundation.json"),
      "changed"
    )
    await expect(writeCaseStudyArtifacts(directory, result)).rejects.toThrow(
      "Refusing to overwrite"
    )
  })
})
