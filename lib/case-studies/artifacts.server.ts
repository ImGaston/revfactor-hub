import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  CaseStudyCandidate,
  CaseStudyFoundationResult,
} from "@/lib/case-studies/contracts"
import { canonicalJson, sha256 } from "@/lib/case-studies/domain"

const FILES = {
  json: "case-study-foundation.json",
  csv: "case-study-candidates.csv",
  report: "case-study-executive-report.md",
  blocked: "case-study-blocked-evidence.md",
  manifest: "source-manifest.json",
  checksums: "SHA256SUMS",
} as const

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${protectedText.replaceAll('"', '""')}"`
}

function allPeriod(candidate: CaseStudyCandidate) {
  return candidate.periods.find((period) => period.label === "all_supported")!
}

function renderCsv(result: CaseStudyFoundationResult): string {
  const header = [
    "rank",
    "state",
    "hub_listing_id",
    "pricelabs_listing_id",
    "client_id",
    "client_name",
    "listing_name",
    "case_type",
    "management_start_date",
    "start_confidence",
    "launch_date",
    "raw_metric_rows",
    "supported_months",
    "comparable_months",
    "avg_revpar_index",
    "avg_market_adjusted_revpar_lift_pp",
    "qa_flags",
    "public_identity_approved",
  ]
  const rows = result.candidates.map((candidate) => {
    const summary = allPeriod(candidate)
    return [
      candidate.rank,
      candidate.state,
      candidate.hubListingId,
      candidate.priceLabsListingId,
      candidate.clientId,
      candidate.clientName,
      candidate.listingName,
      candidate.caseType,
      candidate.managementStartDate,
      candidate.managementStartConfidence,
      candidate.launchDate,
      candidate.rawMetricRowCount,
      candidate.supportedManagedMonthCount,
      candidate.comparableMonthCount,
      summary.averageRevparIndex,
      summary.averageMarketAdjustedRevparLiftPp,
      candidate.qaFlags.join("|"),
      candidate.publicIdentityApproved,
    ]
      .map(csvCell)
      .join(",")
  })
  return `${[header.map(csvCell).join(","), ...rows].join("\n")}\n`
}

function renderReport(result: CaseStudyFoundationResult): string {
  const ready = result.candidates.filter((candidate) => candidate.rank !== null)
  const lines = [
    "# RevFactor Case-Study Foundation",
    "",
    `- As of: ${result.asOf}`,
    `- Workflow: ${result.workflowVersion}`,
    `- Source fingerprint: \`${result.sourceFingerprint}\``,
    `- Latest completed Report Builder run: \`${result.reportRun.id}\``,
    `- Selected/analyzed/blocked: ${result.counts.selectedListings}/${result.counts.analyzed}/${result.counts.blocked}`,
    "- Publication status: internal evidence only; every public identity remains unapproved.",
    "",
    "## Strongest internally supported candidates",
    "",
  ]
  if (ready.length === 0) {
    lines.push("No candidate cleared the quantitative and QA gates.")
  } else {
    for (const candidate of ready) {
      const summary = allPeriod(candidate)
      lines.push(
        `${candidate.rank}. **${candidate.listingName}** — ${candidate.caseType}; ${candidate.supportedManagedMonthCount} supported months; average RevPAR index ${summary.averageRevparIndex?.toFixed(1) ?? "n/a"}; market-adjusted RevPAR lift ${summary.averageMarketAdjustedRevparLiftPp?.toFixed(1) ?? "n/a"} pp.`
      )
    }
  }
  lines.push(
    "",
    "## Safe non-numeric fallback",
    "",
    "RevFactor supports listing performance with structured pricing, market monitoring, and ongoing revenue-management review. No numeric result or client identity may be published without source-level QA and Federico's approval.",
    ""
  )
  return lines.join("\n")
}

function renderBlocked(result: CaseStudyFoundationResult): string {
  const blocked = result.candidates.filter(
    (candidate) => candidate.rank === null
  )
  const lines = ["# Blocked and Missing Evidence", ""]
  if (blocked.length === 0) lines.push("No blocked candidates.")
  for (const candidate of blocked) {
    lines.push(
      `- **${candidate.listingName}** (\`${candidate.hubListingId}\`): ${candidate.state}; ${candidate.qaFlags.join(", ") || "no detailed flag"}.`
    )
  }
  lines.push("")
  return lines.join("\n")
}

function renderFiles(
  result: CaseStudyFoundationResult
): Record<string, string> {
  const core: Record<string, string> = {
    [FILES.json]: canonicalJson(result),
    [FILES.csv]: renderCsv(result),
    [FILES.report]: renderReport(result),
    [FILES.blocked]: renderBlocked(result),
  }
  const manifest = {
    workflowVersion: result.workflowVersion,
    projectRef: result.projectRef,
    asOf: result.asOf,
    reportRunId: result.reportRun.id,
    reportTemplateId: result.reportRun.template_id,
    reportCompletedAt: result.reportRun.completed_at,
    sourceFingerprint: result.sourceFingerprint,
    selection: result.selection,
    dataClassification: {
      classification: "restricted_internal_pii",
      containsClientAndListingPII: true,
      redactionStatus: "not_redacted_internal_evidence",
      publicDistributionAllowed: false,
      publicIdentityApproved: false,
    },
    artifacts: Object.fromEntries(
      Object.entries(core)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, body]) => [
          name,
          {
            sha256: sha256(body),
            classification: "restricted_internal_pii",
          },
        ])
    ),
  }
  core[FILES.manifest] = canonicalJson(manifest)
  core[FILES.checksums] = `${Object.entries(core)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, body]) => `${sha256(body)}  ${name}`)
    .join("\n")}\n`
  return core
}

export async function writeCaseStudyArtifacts(
  outputDirectory: string,
  result: CaseStudyFoundationResult
): Promise<Record<string, string>> {
  if (!path.isAbsolute(outputDirectory))
    throw new Error("Output directory must be absolute")
  const expected = renderFiles(result)
  await mkdir(outputDirectory, { recursive: true })
  const existing = await readdir(outputDirectory)
  const unexpected = existing.filter((name) => !(name in expected))
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing non-empty output directory with unexpected files: ${unexpected.join(",")}`
    )
  }
  for (const [name, body] of Object.entries(expected)) {
    const filePath = path.join(outputDirectory, name)
    if (existing.includes(name)) {
      const prior = await readFile(filePath, "utf8")
      if (prior !== body)
        throw new Error(`Refusing to overwrite changed artifact ${name}`)
    } else {
      await writeFile(filePath, body, { encoding: "utf8", flag: "wx" })
    }
  }
  return Object.fromEntries(
    Object.entries(expected).map(([name, body]) => [name, sha256(body)])
  )
}
