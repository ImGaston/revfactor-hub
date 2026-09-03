import { readFile } from "node:fs/promises"
import path from "node:path"

import { writeCaseStudyArtifacts } from "@/lib/case-studies/artifacts.server"
import { parseCaseStudyCliArgs } from "@/lib/case-studies/cli"
import {
  caseStudySelectionSchema,
  type CaseStudySelection,
} from "@/lib/case-studies/contracts"
import { analyzeCaseStudyFoundation } from "@/lib/case-studies/domain"
import {
  createReadOnlyCaseStudyClient,
  loadCaseStudySourceInventory,
} from "@/lib/case-studies/repository.server"

async function main() {
  const args = parseCaseStudyCliArgs(process.argv.slice(2))
  let selection: CaseStudySelection | null = null
  if (args.selectionFile) {
    selection = caseStudySelectionSchema.parse(
      JSON.parse(await readFile(path.resolve(args.selectionFile), "utf8"))
    )
  }
  const inventory = await loadCaseStudySourceInventory(
    createReadOnlyCaseStudyClient(),
    {
      asOf: args.asOf,
      selection,
      expectedReportTemplateId: args.templateId,
    }
  )
  const result = analyzeCaseStudyFoundation(inventory)
  const artifacts = await writeCaseStudyArtifacts(args.output, result)
  process.stdout.write(
    `${JSON.stringify({ sourceFingerprint: result.sourceFingerprint, counts: result.counts, artifacts })}\n`
  )
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown failure"}\n`
  )
  process.exitCode = 1
})
