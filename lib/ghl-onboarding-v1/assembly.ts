import { z } from "zod"
import {
  JourneySchema,
  missingRequirements,
  type Journey,
} from "@/lib/ghl-onboarding-v1/domain"

// Official contract: https://assembly.com/docs/api-reference/openapi.json
// Credentials are injected by the server worker; this module never reads browser state.
const CompanySchema = z.object({
  id: z.string().min(1),
  customFields: z.record(z.string(), z.unknown()).nullish(),
  deleted: z.boolean().optional(),
})
const ClientSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  companyId: z.string().nullish(),
  companyIds: z.array(z.string()).optional(),
  status: z.enum(["notInvited", "invited", "active"]),
  firstLoginDate: z.string().nullish(),
  deleted: z.boolean().optional(),
})
export type PortalCompany = z.infer<typeof CompanySchema>
export type PortalClient = z.infer<typeof ClientSchema>
export type FieldMapping = {
  ownerExternalKey: string
  propertySummaryKey: string
}
export type AssemblyApi = {
  verifyCompanyFields(mapping: FieldMapping): Promise<void>
  findClients(email: string): Promise<PortalClient[]>
  findCompanies(externalKey: string, value: string): Promise<PortalCompany[]>
  getCompany(id: string): Promise<PortalCompany>
  getClient(id: string): Promise<PortalClient>
  createCompany(
    name: string,
    customFields: Record<string, unknown>
  ): Promise<PortalCompany>
  updateCompany(
    id: string,
    customFields: Record<string, unknown>
  ): Promise<PortalCompany>
  createClient(input: {
    givenName: string
    familyName: string
    email: string
    companyId: string
  }): Promise<PortalClient>
  inviteClient(id: string): Promise<PortalClient>
}
export class AssemblyFailure extends Error {
  constructor(
    public readonly code:
      | "request_failed"
      | "response_invalid"
      | "pagination_incomplete"
      | "fields_missing",
    public readonly uncertain: boolean,
    public readonly status?: number
  ) {
    super(`assembly_${code}`)
  }
}
export function createAssemblyApi(
  apiKey: string,
  fetcher: typeof fetch = fetch
): AssemblyApi {
  if (!apiKey.trim()) throw new Error("assembly_not_configured")
  const deadline = Date.now() + 60_000
  async function request(
    path: string,
    method = "GET",
    body?: unknown
  ): Promise<unknown> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new AssemblyFailure("request_failed", false)
    const write = method !== "GET"
    let response: Response
    try {
      response = await fetcher(`https://api.assembly.com/v1${path}`, {
        method,
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(Math.min(10_000, remaining)),
        redirect: "error",
        cache: "no-store",
      })
    } catch {
      throw new AssemblyFailure("request_failed", write)
    }
    // No response bodies or credentials in errors. Writes are NEVER automatically retried.
    if (!response.ok)
      throw new AssemblyFailure(
        "request_failed",
        write &&
          (response.status >= 500 ||
            response.status === 408 ||
            response.status === 429),
        response.status
      )
    if (write && response.headers.get("X-Ignored-Fields"))
      throw new AssemblyFailure("response_invalid", true)
    try {
      return await response.json()
    } catch {
      throw new AssemblyFailure("response_invalid", write)
    }
  }
  function parse<T>(schema: z.ZodType<T>, body: unknown, write = false): T {
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new AssemblyFailure("response_invalid", write)
    return parsed.data
  }
  async function list<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const data: T[] = []
    const seen = new Set<string>()
    let token: string | undefined
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams(path.split("?")[1])
      params.set("limit", "100")
      if (token) params.set("nextToken", token)
      const result = parse(
        z.object({ data: z.array(schema), nextToken: z.string().nullish() }),
        await request(`${path.split("?")[0]}?${params}`)
      )
      data.push(...result.data)
      if (!result.nextToken) return data
      if (seen.has(result.nextToken)) break
      seen.add(result.nextToken)
      token = result.nextToken
    }
    throw new AssemblyFailure("pagination_incomplete", false)
  }
  return {
    async verifyCompanyFields(mapping) {
      if (
        !mapping.ownerExternalKey ||
        !mapping.propertySummaryKey ||
        mapping.ownerExternalKey === mapping.propertySummaryKey
      )
        throw new AssemblyFailure("fields_missing", false)
      const result = parse(
        z.object({
          data: z.array(
            z.object({
              key: z.string(),
              entityType: z.string(),
              type: z.string(),
            })
          ),
        }),
        await request("/custom-fields?entityType=company")
      )
      for (const key of Object.values(mapping))
        if (
          !result.data.some(
            (f) =>
              f.key === key && f.entityType === "company" && f.type === "text"
          )
        )
          throw new AssemblyFailure("fields_missing", false)
    },
    async findClients(email) {
      return (
        await list(`/clients?email=${encodeURIComponent(email)}`, ClientSchema)
      ).filter(
        (c) => c.email.toLowerCase() === email.toLowerCase() && !c.deleted
      )
    },
    async findCompanies(key, value) {
      return (await list("/companies", CompanySchema)).filter(
        (c) => !c.deleted && c.customFields?.[key] === value
      )
    },
    async getCompany(id) {
      return parse(
        CompanySchema,
        await request(`/companies/${encodeURIComponent(id)}`)
      )
    },
    async getClient(id) {
      return parse(
        ClientSchema,
        await request(`/clients/${encodeURIComponent(id)}`)
      )
    },
    async createCompany(name, customFields) {
      return parse(
        CompanySchema,
        await request("/companies", "POST", { name, customFields }),
        true
      )
    },
    async updateCompany(id, customFields) {
      return parse(
        CompanySchema,
        await request(`/companies/${encodeURIComponent(id)}`, "PATCH", {
          customFields,
        }),
        true
      )
    },
    async createClient(input) {
      return parse(
        ClientSchema,
        await request("/clients?sendInvite=false", "POST", input),
        true
      )
    },
    async inviteClient(id) {
      return parse(
        ClientSchema,
        await request(
          `/clients/${encodeURIComponent(id)}?sendInvite=true`,
          "PATCH",
          {}
        ),
        true
      )
    },
  }
}

export type ProvisionIntent =
  | "create_company"
  | "update_company"
  | "create_client"
  | "invite"
export type PropertyHandoff = {
  id: string
  name: string
  address: Journey["properties"][number]["address"]
  listingUrl: string | null
  status: string | null
}
export type AssemblyCheckpoint = {
  revision: number
  companyId: string | null
  clientId: string | null
  intent: ProvisionIntent | null
  email: string
  properties: PropertyHandoff[]
  journeyIds: string[]
  handoffComplete: boolean
}
export type AssemblyCheckpointStore = {
  load(ownerKey: string): Promise<AssemblyCheckpoint | null>
  // Atomic compare-and-set. null means INSERT ONLY. Must persist before resolving true.
  // Scope uniqueness to the configured Assembly portal + ownerKey in the DB adapter.
  compareAndSet(
    ownerKey: string,
    revision: number | null,
    next: AssemblyCheckpoint
  ): Promise<boolean>
}
export type ProvisionResult = {
  status: "portal_invited" | "portal_active" | "pending" | "manual_review"
  reason?: string
  companyId?: string
  clientId?: string
}
const memberships = (client: PortalClient) => [
  ...new Set([
    ...(client.companyIds ?? []),
    ...(client.companyId ? [client.companyId] : []),
  ]),
]
export const isPortalActive = (client: PortalClient) =>
  client.status === "active" ||
  (!!client.firstLoginDate &&
    Number.isFinite(Date.parse(client.firstLoginDate)))

/** One bounded step per invocation; worker retries pending results with a delay.
 * An unresolved write intent is evidence of uncertainty, never permission to repeat a POST.
 * The final accepted questionnaire stays in Hub; only confirmed property identity is copied.
 */
export async function provisionAssembly(
  input: Journey,
  dependencies: {
    api: AssemblyApi
    store: AssemblyCheckpointStore
    mapping: FieldMapping
  }
): Promise<ProvisionResult> {
  const journey = JourneySchema.parse(input)
  if (
    !["submitted", "portal_invited", "portal_active"].includes(journey.stage) ||
    !journey.submittedAt ||
    journey.manualTakeover ||
    missingRequirements(journey).length
  )
    throw new Error("assembly_journey_not_accepted")
  const { api, store, mapping } = dependencies
  const ownerKey = `rf-owner:${journey.contactId}`
  let state = await store.load(ownerKey)
  const review = (reason: string): ProvisionResult => ({
    status: "manual_review",
    reason,
    ...(state?.companyId ? { companyId: state.companyId } : {}),
    ...(state?.clientId ? { clientId: state.clientId } : {}),
  })
  async function save(patch: Partial<AssemblyCheckpoint>) {
    if (!state) throw new Error("assembly_checkpoint_missing")
    const next = { ...state, ...patch, revision: state.revision + 1 }
    if (!(await store.compareAndSet(ownerKey, state.revision, next)))
      return false
    state = next
    return true
  }
  const pending: ProvisionResult = { status: "pending" }
  if (!state) {
    const initial: AssemblyCheckpoint = {
      revision: 0,
      companyId: null,
      clientId: null,
      intent: null,
      email: journey.email,
      properties: [],
      journeyIds: [],
      handoffComplete: false,
    }
    if (!(await store.compareAndSet(ownerKey, null, initial))) return pending
    state = initial
  }
  if (state.email !== journey.email) return review("owner_email_changed")
  await api.verifyCompanyFields(mapping)
  // Finish the earlier run's uncertain operation before adding another journey.
  if (!state.journeyIds.includes(journey.id)) {
    if (state.intent) return review("earlier_journey_write_unresolved")
    const properties = new Map(state.properties.map((p) => [p.id, p]))
    for (const {
      id,
      name,
      address,
      listingUrl,
      status,
    } of journey.properties) {
      const property = { id, name, address, listingUrl, status }
      const old = properties.get(id)
      if (old && JSON.stringify(old) !== JSON.stringify(property))
        return review("accepted_property_changed")
      properties.set(id, property)
    }
    if (
      !(await save({
        properties: [...properties.values()],
        journeyIds: [...state.journeyIds, journey.id],
        handoffComplete: false,
      }))
    )
      return pending
  }
  const clients = await api.findClients(journey.email)
  if (clients.length > 1) return review("ambiguous_client_email")
  let client = clients[0]
  if (state.clientId) {
    const observed = await api.getClient(state.clientId)
    if (
      observed.deleted ||
      observed.email.toLowerCase() !== journey.email ||
      (client && client.id !== observed.id)
    )
      return review("client_identity_changed")
    client = observed
  }
  if (client) {
    const ids = memberships(client)
    if (ids.length !== 1 || (state.companyId && state.companyId !== ids[0]))
      return review("ambiguous_company_membership")
    if (
      !state.companyId &&
      !(await save({ companyId: ids[0], clientId: client.id }))
    )
      return pending
  }
  if (!state.companyId) {
    const companies = await api.findCompanies(
      mapping.ownerExternalKey,
      ownerKey
    )
    if (companies.length > 1) return review("ambiguous_owner_company")
    if (companies.length === 1) {
      if (!(await save({ companyId: companies[0].id, intent: null })))
        return pending
      return pending
    }
    if (state.intent) return review("company_create_uncertain")
    if (!(await save({ intent: "create_company" }))) return pending
    try {
      const company = await api.createCompany(`${journey.name} properties`, {
        [mapping.ownerExternalKey]: ownerKey,
      })
      if (
        company.deleted ||
        company.customFields?.[mapping.ownerExternalKey] !== ownerKey
      )
        return review("company_identity_unconfirmed")
      await save({ companyId: company.id, intent: null })
    } catch (error) {
      if (error instanceof AssemblyFailure && !error.uncertain)
        await save({ intent: null })
      throw error
    }
    return pending
  }
  const company = await api.getCompany(state.companyId)
  if (company.deleted) return review("company_deleted")
  const marker = company.customFields?.[mapping.ownerExternalKey]
  if (marker && marker !== ownerKey) return review("company_owner_conflict")
  const existingSummary = company.customFields?.[mapping.propertySummaryKey]
  if (existingSummary) {
    try {
      const parsed = JSON.parse(String(existingSummary)) as {
        version?: string
        properties?: PropertyHandoff[]
      }
      if (
        parsed.version !== "rf.properties.v1" ||
        !Array.isArray(parsed.properties) ||
        parsed.properties.some(
          (p) =>
            !state!.properties.some(
              (known) => JSON.stringify(known) === JSON.stringify(p)
            )
        )
      )
        return review("existing_properties_require_reconciliation")
    } catch {
      return review("existing_properties_require_reconciliation")
    }
  }
  const summary = JSON.stringify({
    version: "rf.properties.v1",
    properties: state.properties,
  })
  if (
    marker !== ownerKey ||
    company.customFields?.[mapping.propertySummaryKey] !== summary
  ) {
    if (state.intent && state.intent !== "update_company")
      return review("earlier_write_unresolved")
    // Repeating this exact field assignment has no notification/create side effect.
    if (!(await save({ intent: "update_company" }))) return pending
    const updated = await api.updateCompany(company.id, {
      ...(company.customFields ?? {}),
      [mapping.ownerExternalKey]: ownerKey,
      [mapping.propertySummaryKey]: summary,
    })
    if (
      updated.customFields?.[mapping.ownerExternalKey] !== ownerKey ||
      updated.customFields?.[mapping.propertySummaryKey] !== summary
    )
      return review("property_handoff_unconfirmed")
    await save({ intent: null, handoffComplete: true })
    return pending
  }
  if (!state.handoffComplete || state.intent === "update_company") {
    if (!(await save({ intent: null, handoffComplete: true }))) return pending
  }
  if (!client) {
    if (state.intent) return review("client_create_uncertain")
    const parts = journey.name.trim().split(/\s+/)
    if (parts.length < 2) return review("client_name_confirmation_required")
    if (!(await save({ intent: "create_client" }))) return pending
    try {
      const created = await api.createClient({
        givenName: parts[0],
        familyName: parts.slice(1).join(" "),
        email: journey.email,
        companyId: company.id,
      })
      if (
        created.email.toLowerCase() !== journey.email ||
        memberships(created).length !== 1 ||
        memberships(created)[0] !== company.id ||
        created.deleted
      )
        return review("created_client_identity_unconfirmed")
      await save({ clientId: created.id, intent: null })
    } catch (error) {
      if (error instanceof AssemblyFailure && !error.uncertain)
        await save({ intent: null })
      throw error
    }
    return pending
  }
  if (!state.clientId || state.intent === "create_client") {
    if (!(await save({ clientId: client.id, intent: null }))) return pending
  }
  if (isPortalActive(client) || client.status === "invited") {
    if (state.intent === "invite" && !(await save({ intent: null })))
      return pending
    return {
      status: isPortalActive(client) ? "portal_active" : "portal_invited",
      companyId: company.id,
      clientId: client.id,
    }
  }
  if (state.intent) return review("invite_uncertain")
  if (!(await save({ intent: "invite" }))) return pending
  try {
    const invited = await api.inviteClient(client.id)
    if (
      invited.id !== client.id ||
      invited.email.toLowerCase() !== journey.email ||
      memberships(invited).length !== 1 ||
      memberships(invited)[0] !== company.id ||
      invited.deleted
    )
      return review("invited_client_identity_unconfirmed")
    if (!isPortalActive(invited) && invited.status !== "invited")
      return review("invite_delivery_unconfirmed")
    if (!(await save({ intent: null }))) return pending
    return {
      status: isPortalActive(invited) ? "portal_active" : "portal_invited",
      companyId: company.id,
      clientId: client.id,
    }
  } catch (error) {
    if (error instanceof AssemblyFailure && !error.uncertain)
      await save({ intent: null })
    throw error
  }
}
