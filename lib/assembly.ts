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
