import "server-only"
import { z } from "zod"
import { assertRolloutContact } from "./rollout"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  AddressSchema,
  JourneySchema,
  type Journey,
} from "@/lib/ghl-onboarding-v1/domain"
import {
  AssemblyFailure,
  createAssemblyApi,
  isPortalActive,
  provisionAssembly,
  type AssemblyApi,
  type AssemblyCheckpointStore,
  type FieldMapping,
  type ProvisionResult,
} from "@/lib/ghl-onboarding-v1/assembly"

const JobSchema = z.object({
  id: z.uuid(),
  journey_id: z.uuid(),
  kind: z.enum(["assembly_provision", "activation_check"]),
  lease_token: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
})
export type AssemblyJob = z.infer<typeof JobSchema>
const CheckpointSchema = z.object({
  revision: z.number().int().min(0),
  companyId: z.string().nullable(),
  clientId: z.string().nullable(),
  intent: z
    .enum(["create_company", "update_company", "create_client", "invite"])
    .nullable(),
  email: z.email(),
  properties: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      address: AddressSchema,
      listingUrl: z.string().nullable(),
      status: z.string().nullable(),
    })
  ),
  journeyIds: z.array(z.uuid()),
  handoffComplete: z.boolean(),
})
export type AcceptedJobJourney = {
  snapshot: Journey
  stage: Journey["stage"]
  manualTakeover: boolean
  companyId: string | null
  clientId: string | null
}
export type AssemblyWorkerRepository = {
  claim(kind: AssemblyJob["kind"]): Promise<AssemblyJob | null>
  acceptedJourney(id: string): Promise<AcceptedJobJourney>
  checkpoints(job: AssemblyJob, portalId: string): AssemblyCheckpointStore
  finish(
    job: AssemblyJob,
    outcome: ProvisionResult | { status: "failed"; reason: string }
  ): Promise<boolean>
}
export type AssemblyWorkerConfig = {
  enabled: boolean
  assemblyEnabled: boolean
  portalCompatible: boolean
  apiKey?: string
  portalId?: string
  ownerField?: string
  propertiesField?: string
}
export function assemblyWorkerConfig(
  env: Record<string, string | undefined> = process.env
): AssemblyWorkerConfig {
  return {
    enabled: env.GHL_V1_ENABLED === "true",
    assemblyEnabled: env.GHL_V1_ASSEMBLY_ENABLED === "true",
    portalCompatible: env.GHL_V1_PORTAL_COMPATIBILITY_VERIFIED === "true",
    apiKey: env.ASSEMBLY_API_KEY,
    portalId: env.GHL_V1_ASSEMBLY_PORTAL_ID,
    ownerField: env.GHL_V1_ASSEMBLY_OWNER_FIELD,
    propertiesField: env.GHL_V1_ASSEMBLY_PROPERTIES_FIELD,
  }
}

export function createAssemblyWorkerRepository(
  db = createAdminClient()
): AssemblyWorkerRepository {
  return {
    async claim(kind) {
      const { data, error } = await db.rpc("claim_ghl_onboarding_job", {
        p_kind: kind,
      })
      if (error) throw new Error("assembly_job_claim_failed")
      if (!data?.length) return null
      const job = JobSchema.safeParse(data[0])
      if (!job.success) throw new Error("assembly_job_invalid")
      return job.data
    },
    async acceptedJourney(id) {
      // Privileged projection: never return this record from a public route.
      const { data, error } = await db
        .from("ghl_onboarding_journeys")
        .select(
          "id,stage,payload,submitted_snapshot,assembly_client_id,assembly_company_id"
        )
        .eq("id", id)
        .single()
      if (error || !data?.submitted_snapshot)
        throw new Error("assembly_accepted_snapshot_missing")
      const snapshot = JourneySchema.parse(data.submitted_snapshot)
      if (snapshot.id !== id)
        throw new Error("assembly_snapshot_identity_mismatch")
      const live = JourneySchema.parse(data.payload)
      if (
        live.id !== id ||
        live.stage !== data.stage ||
        live.contactId !== snapshot.contactId ||
        live.email !== snapshot.email
      )
        throw new Error("assembly_snapshot_identity_mismatch")
      return {
        snapshot,
        stage: live.stage,
        manualTakeover: live.manualTakeover,
        companyId: data.assembly_company_id,
        clientId: data.assembly_client_id,
      }
    },
    checkpoints(job, portalId) {
      return {
        async load(ownerKey) {
          const { data, error } = await db
            .from("ghl_assembly_checkpoints")
            .select("payload")
            .eq("portal_id", portalId)
            .eq("owner_key", ownerKey)
            .maybeSingle()
          if (error) throw new Error("assembly_checkpoint_read_failed")
          if (!data) return null
          const parsed = CheckpointSchema.safeParse(data.payload)
          if (!parsed.success) throw new Error("assembly_checkpoint_invalid")
          return parsed.data
        },
        async compareAndSet(ownerKey, revision, next) {
          const { data, error } = await db.rpc("cas_ghl_assembly_checkpoint", {
            p_portal_id: portalId,
            p_owner_key: ownerKey,
            p_revision: revision,
            p_payload: next,
            p_job_id: job.id,
            p_lease_token: job.lease_token,
          })
          if (error) throw new Error("assembly_checkpoint_write_failed")
          return data === true
        },
      }
    },
    async finish(job, outcome) {
      const result =
        "companyId" in outcome
          ? {
              status: outcome.status,
              companyId: outcome.companyId,
              clientId: outcome.clientId,
            }
          : { status: outcome.status }
      const { data, error } = await db.rpc("finish_ghl_assembly_job", {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_outcome: outcome.status,
        p_result: result,
        p_error_code: outcome.reason ?? null,
      })
      if (error) throw new Error("assembly_job_finish_failed")
      return data === true
    },
  }
}

export async function runAssemblyJob(
  job: AssemblyJob,
  dependencies: {
    repository: AssemblyWorkerRepository
    api: AssemblyApi
    portalId: string
    mapping: FieldMapping
    now?: () => number
  }
): Promise<ProvisionResult> {
  const row = await dependencies.repository.acceptedJourney(job.journey_id)
  try {
    assertRolloutContact(row.snapshot.contactId)
  } catch {
    return { status: "manual_review", reason: "assembly_rollout_restricted" }
  }
  if (
    row.manualTakeover ||
    !["submitted", "portal_invited", "portal_active"].includes(row.stage)
  )
    return { status: "manual_review", reason: "assembly_journey_paused" }
  if (job.kind === "assembly_provision") {
    // Execute from the frozen accepted record; current payload only gates stage/takeover.
    return provisionAssembly(row.snapshot, {
      api: dependencies.api,
      store: dependencies.repository.checkpoints(job, dependencies.portalId),
      mapping: dependencies.mapping,
    })
  }
  if (!row.clientId || !row.companyId)
    return { status: "manual_review", reason: "activation_identity_missing" }
  const client = await dependencies.api.getClient(row.clientId)
  const companies = [
    ...new Set([
      ...(client.companyIds ?? []),
      ...(client.companyId ? [client.companyId] : []),
    ]),
  ]
  if (
    client.deleted ||
    client.id !== row.clientId ||
    client.email.toLowerCase() !== row.snapshot.email ||
    companies.length !== 1 ||
    companies[0] !== row.companyId
  )
    return { status: "manual_review", reason: "activation_identity_conflict" }
  if (isPortalActive(client))
    return {
      status: "portal_active",
      clientId: client.id,
      companyId: row.companyId,
    }
  if (
    (dependencies.now?.() ?? Date.now()) - Date.parse(job.created_at) >=
    7 * 86400000
  )
    return {
      status: "manual_review",
      reason: "portal_activation_followup_required",
    }
  if (client.status !== "invited")
    return {
      status: "manual_review",
      reason: "portal_invitation_state_changed",
    }
  // Activation checks are strictly read-only: never call provision or resend an invite.
  return {
    status: "portal_invited",
    clientId: client.id,
    companyId: row.companyId,
  }
}

export async function processAssemblyJobs(
  options: { maxJobs?: number; config?: AssemblyWorkerConfig } = {},
  dependencies?: {
    repository: AssemblyWorkerRepository
    apiFactory: () => AssemblyApi
    now?: () => number
  }
) {
  const config = options.config ?? assemblyWorkerConfig()
  const counts = {
    claimed: 0,
    pending: 0,
    completed: 0,
    manualReview: 0,
    failed: 0,
    staleLease: 0,
  }
  if (!config.enabled || !config.assemblyEnabled)
    return { ...counts, state: "disabled" as const }
  if (
    ![
      config.apiKey,
      config.portalId,
      config.ownerField,
      config.propertiesField,
    ].every((v) => v?.trim())
  )
    return { ...counts, state: "not_configured" as const }
  if (!config.portalCompatible)
    return { ...counts, state: "portal_compatibility_required" as const }
  const repository =
    dependencies?.repository ?? createAssemblyWorkerRepository()
  const apiFactory =
    dependencies?.apiFactory ?? (() => createAssemblyApi(config.apiKey!))
  const now = dependencies?.now ?? Date.now
  const started = now()
  const limit = Math.min(3, Math.max(1, Math.trunc(options.maxJobs ?? 3)))
  const kinds: AssemblyJob["kind"][] = [
    "assembly_provision",
    "activation_check",
  ]
  for (let i = 0; i < limit && now() - started < 210_000; i++) {
    const first = kinds[i % 2]
    const job =
      (await repository.claim(first)) ??
      (await repository.claim(kinds[(i + 1) % 2]))
    if (!job) break
    counts.claimed++
    let result: ProvisionResult | { status: "failed"; reason: string }
    try {
      result = await runAssemblyJob(job, {
        repository,
        api: apiFactory(),
        portalId: config.portalId!,
        mapping: {
          ownerExternalKey: config.ownerField!,
          propertySummaryKey: config.propertiesField!,
        },
        now,
      })
    } catch (error) {
      // Static codes only: Zod errors and upstream exceptions can contain client data.
      result = {
        status: "failed",
        reason:
          error instanceof AssemblyFailure
            ? `assembly_${error.code}`
            : "assembly_worker_failed",
      }
    }
    let finished: boolean
    try {
      finished = await repository.finish(job, result)
    } catch {
      // An operations-normalization failure must reach the durable retry/exception
      // ledger. If the first commit actually succeeded, the lease check rejects this.
      result = { status: "failed", reason: "assembly_handoff_commit_failed" }
      finished = await repository.finish(job, result)
    }
    if (!finished) {
      counts.staleLease++
      continue
    }
    if (
      result.status === "pending" ||
      (result.status === "portal_invited" && job.kind === "activation_check")
    )
      counts.pending++
    else if (result.status === "manual_review") counts.manualReview++
    else if (result.status === "failed") counts.failed++
    else counts.completed++
  }
  return { ...counts, state: "processed" as const }
}
