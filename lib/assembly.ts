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

async function assemblyFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const res = await fetch(`${ASSEMBLY_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": getApiKey(),
        ...options?.headers,
      },
    })

    if (res.status === 429) {
      // Retry once after 1s on rate limit
      await new Promise((r) => setTimeout(r, 1000))
      const retry = await fetch(`${ASSEMBLY_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": getApiKey(),
          ...options?.headers,
        },
      })
      if (!retry.ok) {
        throw new Error(`Assembly API error: ${retry.status} ${retry.statusText}`)
      }
      return retry.json()
    }

    if (!res.ok) {
      throw new Error(`Assembly API error: ${res.status} ${res.statusText}`)
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
  const result = await assemblyFetch<AssemblyListResponse<AssemblyClient>>(
    `/clients?email=${encodeURIComponent(email)}`
  )
  return result.data[0] ?? null
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
  const result = await assemblyFetch<AssemblyListResponse<AssemblyChannel>>(
    `/message-channels?clientId=${clientId}`
  )
  return result.data[0] ?? null
}

export async function getCompanyChannels(
  clientId: string
): Promise<AssemblyChannel[]> {
  const result = await assemblyFetch<AssemblyListResponse<AssemblyChannel>>(
    `/message-channels?memberId=${clientId}&membershipType=company`
  )
  return result.data
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
