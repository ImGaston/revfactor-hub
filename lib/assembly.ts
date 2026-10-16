const ASSEMBLY_BASE_URL = "https://api.assembly.com/v1"
const FETCH_TIMEOUT = 10_000

// --- Types ---

export type AssemblyClient = {
  id: string
  createdAt: string
  updatedAt: string
  object: "client"
  givenName: string
  familyName: string
  email: string
  companyIds: string[]
  status: "notInvited" | "invited" | "active"
  inviteUrl: string
  avatarImageUrl: string | null
  firstLoginDate: string | null
  lastLoginDate: string | null
  fallbackColor: string
  creationMethod: string
  customFields: Record<string, unknown> | null
}

export type AssemblyChannel = {
  id: string
  createdAt: string
  updatedAt: string
  object: "messageChannel"
  membershipType: "individual" | "group" | "company"
  clientId?: string
  companyId?: string
  memberIds: string[]
  lastMessageDate: string | null
}

export type AssemblyFileChannel = {
  id: string
  createdAt: string
  updatedAt: string
  object: "fileChannel"
  clientId?: string
  companyId?: string
  membershipType: "individual" | "group" | "company"
  memberIds: string[]
}

export type AssemblyFile = {
  id: string
  createdAt: string
  updatedAt: string
  object: "file" | "folder" | "link"
  createdBy: string
  channelId: string
  downloadUrl?: string
  uploadUrl?: string
  path: string
  linkUrl?: string
  status?: "pending" | "completed"
  size?: number
}

export type AssemblyMessage = {
  id: string
  createdAt: string
  updatedAt: string
  object: "message"
  senderId: string
  channelId: string
  text: string
  isAttachmentIncluded: boolean
}

export type AssemblyListResponse<T> = {
  data: T[]
  nextToken: string | null
}

// --- Helpers ---

export function isAssemblyConfigured(): boolean {
  return !!process.env.ASSEMBLY_API_KEY
}

function getApiKey(): string {
  const key = process.env.ASSEMBLY_API_KEY
  if (!key) throw new Error("ASSEMBLY_API_KEY is not configured")
  return key
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = await res.text()
    // Try to parse as JSON for a cleaner message
    try {
      const json = JSON.parse(body)
      return json.message || json.error || JSON.stringify(json)
    } catch {
      return body || res.statusText
    }
  } catch {
    return res.statusText
  }
}

async function assemblyFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  const headers = {
    "Content-Type": "application/json",
    "X-API-KEY": getApiKey(),
    ...options?.headers,
  }

  try {
    const res = await fetch(`${ASSEMBLY_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers,
    })

    if (res.status === 429) {
      // Retry once after 1s on rate limit
      await new Promise((r) => setTimeout(r, 1000))
      const retry = await fetch(`${ASSEMBLY_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      })
      if (!retry.ok) {
        const detail = await parseErrorBody(retry)
        throw new Error(`Assembly API ${retry.status}: ${detail}`)
      }
      return retry.json()
    }

    if (!res.ok) {
      const detail = await parseErrorBody(res)
      console.error(`[Assembly] ${options?.method ?? "GET"} ${endpoint} → ${res.status}: ${detail}`)
      throw new Error(`Assembly API ${res.status}: ${detail}`)
    }

    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

// --- Client endpoints ---

export async function searchAssemblyClientByEmail(
  email: string
): Promise<AssemblyClient | null> {
  try {
    const result = await assemblyFetch<AssemblyListResponse<AssemblyClient>>(
      `/clients?email=${encodeURIComponent(email)}`
    )
    return result?.data?.[0] ?? null
  } catch {
    // Client not found or search failed — safe to return null and let caller create
    return null
  }
}

export async function getAssemblyClient(
  id: string
): Promise<AssemblyClient | null> {
  try {
    return await assemblyFetch<AssemblyClient>(`/clients/${id}`)
  } catch {
    return null
  }
}

// --- Channel endpoints ---

export async function getIndividualChannel(
  clientId: string
): Promise<AssemblyChannel | null> {
  try {
    const result = await assemblyFetch<AssemblyListResponse<AssemblyChannel>>(
      `/message-channels?clientId=${clientId}`
    )
    return result?.data?.[0] ?? null
  } catch {
    return null
  }
}

export async function getCompanyChannels(
  clientId: string
): Promise<AssemblyChannel[]> {
  try {
    const result = await assemblyFetch<AssemblyListResponse<AssemblyChannel>>(
      `/message-channels?memberId=${clientId}&membershipType=company`
    )
    return result?.data ?? []
  } catch {
    return []
  }
}

export async function getClientChannels(clientId: string): Promise<{
  individual: AssemblyChannel | null
  company: AssemblyChannel[]
}> {
  const [individual, company] = await Promise.all([
    getIndividualChannel(clientId),
    getCompanyChannels(clientId),
  ])
  return { individual, company }
}

// --- Deep link helpers ---

export function assemblyClientMessagesUrl(clientId: string): string {
  return `https://dashboard.assembly.com/clients/users/details/${clientId}/messages`
}

export function assemblyCompanyMessagesUrl(companyId: string): string {
  return `https://dashboard.assembly.com/companies/${companyId}/messages`
}

// --- Create / Find client ---

export async function createAssemblyClient(opts: {
  givenName: string
  familyName: string
  email: string
  phone?: string
  sendInvite?: boolean
}): Promise<AssemblyClient> {
  const query = opts.sendInvite ? "?sendInvite=true" : ""
  return assemblyFetch<AssemblyClient>(`/clients${query}`, {
    method: "POST",
    body: JSON.stringify({
      givenName: opts.givenName,
      familyName: opts.familyName,
      email: opts.email,
      ...(opts.phone
        ? { customFields: { phoneNumber: opts.phone } }
        : {}),
    }),
  })
}

export async function findOrCreateAssemblyClient(opts: {
  givenName: string
  familyName: string
  email: string
  phone?: string
  sendInvite?: boolean
}): Promise<AssemblyClient> {
  // Try to find existing client by email
  const existing = await searchAssemblyClientByEmail(opts.email)
  if (existing) return existing
  // Create new
  return createAssemblyClient(opts)
}

// --- File channel endpoints ---

export async function getIndividualFileChannel(
  clientId: string
): Promise<AssemblyFileChannel | null> {
  try {
    const result = await assemblyFetch<AssemblyListResponse<AssemblyFileChannel>>(
      `/channels/files?clientId=${clientId}`
    )
    return result?.data?.[0] ?? null
  } catch {
    return null
  }
}

export async function createIndividualFileChannel(
  clientId: string
): Promise<AssemblyFileChannel> {
  return assemblyFetch<AssemblyFileChannel>("/channels/files", {
    method: "POST",
    body: JSON.stringify({
      membershipType: "individual",
      clientId,
    }),
  })
}

export async function getOrCreateFileChannel(
  clientId: string
): Promise<AssemblyFileChannel> {
  const existing = await getIndividualFileChannel(clientId)
  if (existing) return existing
  return createIndividualFileChannel(clientId)
}

// --- File endpoints ---

export async function createAssemblyFileEntry(
  channelId: string,
  path: string
): Promise<AssemblyFile> {
  return assemblyFetch<AssemblyFile>("/files/file", {
    method: "POST",
    body: JSON.stringify({ path, channelId }),
  })
}

export async function createAssemblyLink(
  channelId: string,
  path: string,
  linkUrl: string
): Promise<AssemblyFile> {
  return assemblyFetch<AssemblyFile>("/files/link", {
    method: "POST",
    body: JSON.stringify({ path, channelId, linkUrl }),
  })
}

// --- Message endpoints ---

export async function listAssemblyMessages(
  channelId: string,
  options?: {
    limit?: number
    nextToken?: string
  }
): Promise<AssemblyListResponse<AssemblyMessage>> {
  const params = new URLSearchParams({
    channelId,
    limit: String(Math.min(Math.max(options?.limit ?? 40, 1), 100)),
  })
  if (options?.nextToken) params.set("nextToken", options.nextToken)

  return assemblyFetch<AssemblyListResponse<AssemblyMessage>>(
    `/messages?${params.toString()}`
  )
}

type AssemblyInternalUser = { id: string; email?: string | null }
let internalUsersCache: { at: number; users: AssemblyInternalUser[] } | null = null

/**
 * The Assembly internal user (team member) with this email, or null. Messages
 * sent through the API without a senderId appear as the API key's owner, so
 * staff-triggered sends pass the clicking user's own Assembly id.
 */
export async function findAssemblyInternalUserIdByEmail(email: string | null | undefined): Promise<string | null> {
  const wanted = email?.trim().toLowerCase()
  if (!wanted) return null
  if (!internalUsersCache || Date.now() - internalUsersCache.at > 10 * 60_000) {
    const res = await assemblyFetch<{ data?: AssemblyInternalUser[] }>("/internal-users?limit=500")
    internalUsersCache = { at: Date.now(), users: res?.data ?? [] }
  }
  return internalUsersCache.users.find((u) => u.email?.trim().toLowerCase() === wanted)?.id ?? null
}

export async function sendAssemblyMessage(
  channelId: string,
  text: string,
  senderId?: string
): Promise<AssemblyMessage> {
  return assemblyFetch<AssemblyMessage>("/messages", {
    method: "POST",
    body: JSON.stringify({
      text,
      channelId,
      ...(senderId ? { senderId } : {}),
    }),
  })
}

// --- Message channel creation ---

export async function createIndividualMessageChannel(
  clientId: string
): Promise<AssemblyChannel> {
  return assemblyFetch<AssemblyChannel>("/message-channels", {
    method: "POST",
    body: JSON.stringify({
      membershipType: "individual",
      clientId,
    }),
  })
}

export async function getOrCreateMessageChannel(
  clientId: string
): Promise<AssemblyChannel> {
  const existing = await getIndividualChannel(clientId)
  if (existing) return existing
  return createIndividualMessageChannel(clientId)
}

// --- Contract types ---

export type AssemblyContractTemplate = {
  id: string
  createdAt: string
  updatedAt: string
  object: "contractTemplate"
  name: string
}

export type AssemblyContract = {
  id: string
  createdAt: string
  updatedAt: string
  object: "contract"
  contractTemplateId: string
  clientId: string
  companyId: string | null
  name: string
  status: "pending" | "signed"
  shareDate: string
  fileUrl: string
  signedFileUrl: string | null
  fields: unknown[]
}

// --- Contract endpoints ---

export async function listContractTemplates(
  name?: string
): Promise<AssemblyContractTemplate[]> {
  const query = name ? `?name=${encodeURIComponent(name)}` : ""
  const result = await assemblyFetch<AssemblyListResponse<AssemblyContractTemplate>>(
    `/contract-templates${query}`
  )
  return result?.data ?? []
}

export async function getContractTemplate(
  id: string
): Promise<AssemblyContractTemplate | null> {
  try {
    return await assemblyFetch<AssemblyContractTemplate>(`/contract-templates/${id}`)
  } catch {
    return null
  }
}

export async function createAssemblyContract(opts: {
  contractTemplateId: string
  clientId: string
  companyId?: string
  variableValues?: Record<string, string>
}): Promise<AssemblyContract> {
  return assemblyFetch<AssemblyContract>("/contracts", {
    method: "POST",
    body: JSON.stringify({
      contractTemplateId: opts.contractTemplateId,
      clientId: opts.clientId,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      ...(opts.variableValues
        ? { variableValues: JSON.stringify(opts.variableValues) }
        : {}),
    }),
  })
}

export async function getAssemblyContract(
  id: string
): Promise<AssemblyContract | null> {
  try {
    return await assemblyFetch<AssemblyContract>(`/contracts/${id}`)
  } catch {
    return null
  }
}

export async function listClientContracts(
  clientId: string
): Promise<AssemblyContract[]> {
  const result = await assemblyFetch<AssemblyListResponse<AssemblyContract>>(
    `/contracts?clientId=${encodeURIComponent(clientId)}`
  )
  return result?.data ?? []
}

// --- Custom fields (Tags) ---
//
// Custom-app visibility rules can only follow Tags (multiSelect) custom fields,
// so the Hub grants an app by adding a tag option to the client or company.
// The API schema says multiSelect values are option ids while the doc
// examples show option keys, so reads accept both and writes are verified.

export type AssemblyEntityType = "client" | "company"

export type AssemblyCustomFieldOption = {
  object?: string
  id: string
  key: string
  label?: string
  name?: string
  color?: string
}

export type AssemblyCustomField = {
  object: "customField"
  id: string
  key: string
  name: string
  type: "text" | "number" | "email" | "url" | "phoneNumber" | "address" | "multiSelect"
  entityType: AssemblyEntityType
  order: number
  options?: AssemblyCustomFieldOption[]
}

export type AssemblyCompany = {
  id: string
  object: "company"
  name: string
  createdAt?: string
  isPlaceholder?: boolean
  customFields: Record<string, unknown> | null
}

function entityPath(entityType: AssemblyEntityType, id: string): string {
  return `/${entityType === "company" ? "companies" : "clients"}/${encodeURIComponent(id)}`
}

/** All custom fields, following pagination. Throws on API errors. */
export async function listAssemblyCustomFields(
  entityType?: AssemblyEntityType
): Promise<AssemblyCustomField[]> {
  const fields: AssemblyCustomField[] = []
  let nextToken: string | null = null
  do {
    const params = new URLSearchParams()
    if (entityType) params.set("entityType", entityType)
    if (nextToken) params.set("nextToken", nextToken)
    const query = params.toString()
    const page: AssemblyListResponse<AssemblyCustomField> = await assemblyFetch(
      `/custom-fields${query ? `?${query}` : ""}`
    )
    fields.push(...(page?.data ?? []))
    nextToken = page?.nextToken || null
  } while (nextToken)
  return fields
}

export async function getAssemblyCompany(
  id: string
): Promise<AssemblyCompany | null> {
  try {
    return await assemblyFetch<AssemblyCompany>(`/companies/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
}

/** A client's or company's custom field values. Throws on API errors. */
export async function getAssemblyEntityCustomFields(
  entityType: AssemblyEntityType,
  id: string
): Promise<Record<string, unknown>> {
  const entity = await assemblyFetch<{ customFields: Record<string, unknown> | null }>(
    entityPath(entityType, id)
  )
  return entity?.customFields ?? {}
}

/** Partially updates custom fields; returns the entity's values after the write. */
export async function updateAssemblyEntityCustomFields(
  entityType: AssemblyEntityType,
  id: string,
  customFields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entity = await assemblyFetch<{ customFields: Record<string, unknown> | null }>(
    entityPath(entityType, id),
    { method: "PATCH", body: JSON.stringify({ customFields }) }
  )
  return entity?.customFields ?? {}
}

/** The Tags field by key, falling back to a case-insensitive name match. */
export function findTagsField(
  fields: AssemblyCustomField[],
  fieldKey: string
): AssemblyCustomField | null {
  const wanted = fieldKey.trim().toLowerCase()
  return (
    fields.find((f) => f.key === fieldKey.trim()) ??
    fields.find((f) => f.name?.trim().toLowerCase() === wanted) ??
    null
  )
}

/** The option matching an id, key, or label/name (case-insensitive). */
export function resolveTagOption(
  field: AssemblyCustomField,
  option: string
): AssemblyCustomFieldOption | null {
  const wanted = option.trim().toLowerCase()
  if (!wanted) return null
  const options = field.options ?? []
  return (
    options.find((o) => o.id.toLowerCase() === wanted) ??
    options.find((o) => o.key.toLowerCase() === wanted) ??
    options.find((o) => (o.label ?? o.name ?? "").trim().toLowerCase() === wanted) ??
    null
  )
}

/** The string values stored for a multiSelect field (anything else → []). */
export function tagValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

/**
 * A Tags field's values from an entity's customFields. GET returns them keyed
 * by field key; a company PATCH response keys them by field id instead.
 */
export function fieldTagValues(
  customFields: Record<string, unknown>,
  field: Pick<AssemblyCustomField, "key" | "id">
): string[] {
  return tagValues(customFields[field.key] ?? customFields[field.id])
}

export function hasTagOption(values: string[], option: AssemblyCustomFieldOption): boolean {
  return values.includes(option.id) || values.includes(option.key)
}

/**
 * Existing values plus the option, written as option ids or keys. Values that
 * match a known option are converted; unknown values are kept as they are.
 */
export function mergeTagValues(
  field: AssemblyCustomField,
  values: string[],
  option: AssemblyCustomFieldOption,
  mode: "id" | "key"
): string[] {
  const options = field.options ?? []
  const convert = (value: string) => {
    const match = options.find((o) => o.id === value || o.key === value)
    return match ? match[mode] : value
  }
  return [...new Set([...values.map(convert), option[mode]])]
}

/**
 * Adds a tag option to a client's or company's Tags field, keeping every tag
 * already there. Verifies the write and retries once in the other value format.
 */
export async function addAssemblyTagOption(opts: {
  entityType: AssemblyEntityType
  entityId: string
  fieldKey: string
  option: string
}): Promise<{ alreadyTagged: boolean; fieldKey: string; optionId: string; optionKey: string }> {
  const field = findTagsField(await listAssemblyCustomFields(opts.entityType), opts.fieldKey)
  if (!field) {
    throw new Error(`Assembly ${opts.entityType} custom field "${opts.fieldKey}" not found`)
  }
  if (field.type !== "multiSelect") {
    throw new Error(`Assembly ${opts.entityType} custom field "${field.key}" is not a Tags field`)
  }
  const option = resolveTagOption(field, opts.option)
  if (!option) {
    throw new Error(`Assembly ${opts.entityType} field "${field.key}" has no option "${opts.option}"`)
  }
  const result = { fieldKey: field.key, optionId: option.id, optionKey: option.key }

  const current = fieldTagValues(
    await getAssemblyEntityCustomFields(opts.entityType, opts.entityId),
    field
  )
  if (hasTagOption(current, option)) return { alreadyTagged: true, ...result }

  let lastError: unknown = null
  for (const mode of ["id", "key"] as const) {
    try {
      const after = await updateAssemblyEntityCustomFields(opts.entityType, opts.entityId, {
        [field.key]: mergeTagValues(field, current, option, mode),
      })
      if (hasTagOption(fieldTagValues(after, field), option)) return { alreadyTagged: false, ...result }
      // The write response can differ in shape from a read; confirm with a fresh read.
      const reread = await getAssemblyEntityCustomFields(opts.entityType, opts.entityId)
      if (hasTagOption(fieldTagValues(reread, field), option)) return { alreadyTagged: false, ...result }
      lastError = new Error(`tag not present after writing option ${mode}s`)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `Couldn't add "${option.key}" to ${opts.entityType} ${opts.entityId}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}
