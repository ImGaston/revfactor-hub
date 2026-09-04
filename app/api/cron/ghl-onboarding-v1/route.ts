import { NextResponse } from "next/server"
import { checkBearer } from "@/lib/ghl-onboarding-v1/service.server"
import { processAssemblyJobs } from "@/lib/ghl-onboarding-v1/worker.server"
import { projectGhlProgress } from "@/lib/ghl-onboarding-v1/progress.server"

export const maxDuration = 300
export const runtime = "nodejs"

// Authenticated external scheduler; each subsystem has an independent enablement gate.
export async function GET(request: Request) {
  if (!checkBearer(request, "CRON_SECRET"))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const assembly = await processAssemblyJobs().catch(() => ({
    state: "unavailable" as const,
    failed: 1,
  }))
  const progress = await projectGhlProgress().catch(() => ({
    status: "unavailable",
  }))
  const ok =
    assembly.state !== "unavailable" &&
    assembly.state !== "not_configured" &&
    assembly.failed === 0 &&
    !["unavailable", "failed"].includes(progress.status)
  return NextResponse.json(
    { ok, assembly, progress },
    { status: ok ? 200 : 503 }
  )
}
