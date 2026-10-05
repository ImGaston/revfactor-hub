// Backfill Hub suggested answers for open support tickets that have no draft.
//
//   npx tsx --env-file=.env.local scripts/backfill-support-drafts.ts --dry-run
//   npx tsx --env-file=.env.local scripts/backfill-support-drafts.ts [--limit=10] [--url=https://hub.revfactor.io]
//
// Calls the deployed GET /api/cron/support-drafts with CRON_SECRET in batches
// until nothing is left, so drafts run with the deployment's AI Gateway and
// TYPESAFE_API_KEY (no model keys on this machine). Idempotent: every ticket
// gets at most one automatic draft and a bot draft is never replaced, so it
// is safe to stop and re-run. Stops after a batch that makes no progress.

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=")
    return [key, value.join("=") || "true"]
  })
)

const baseUrl = (args.url ?? process.env.HUB_URL ?? "https://hub.revfactor.io").replace(/\/+$/, "")
const limit = Number(args.limit ?? 10)
const dryRun = args["dry-run"] === "true"
const secret = process.env.CRON_SECRET?.trim()

type BatchResponse = {
  candidates?: number
  next?: number[]
  processed?: { ticket_number: number | null; status: string; reason?: string; error?: string; applied?: boolean }[]
  remaining?: number
  error?: string
}

async function callBatch(): Promise<BatchResponse> {
  const url = new URL("/api/cron/support-drafts", baseUrl)
  url.searchParams.set("limit", String(limit))
  if (dryRun) url.searchParams.set("dryRun", "1")
  const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } })
  const body = (await response.json().catch(() => ({}))) as BatchResponse
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? "request failed"}`)
  return body
}

async function main() {
  if (!secret) throw new Error("CRON_SECRET is required (never paste it into chat or the repo)")

  if (dryRun) {
    const body = await callBatch()
    console.log(`${body.candidates ?? 0} open tickets need a Hub draft. Next: ${(body.next ?? []).map((n) => `#${n}`).join(", ") || "none"}`)
    return
  }

  let previousRemaining = Number.POSITIVE_INFINITY
  for (let round = 1; round <= 50; round += 1) {
    const body = await callBatch()
    for (const p of body.processed ?? []) {
      const detail = p.reason ?? p.error ?? (p.applied === false ? "kept the bot draft" : "")
      console.log(`#${p.ticket_number ?? "?"} ${p.status}${detail ? ` (${detail})` : ""}`)
    }
    const remaining = body.remaining ?? 0
    console.log(`Round ${round}: ${remaining} left`)
    if (remaining === 0 || (body.processed ?? []).length === 0) return
    if (remaining >= previousRemaining) {
      console.log("No progress in the last round (failures repeat). Stopping; check the errors above.")
      return
    }
    previousRemaining = remaining
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
