// PriceLabs Report Builder API client.
// Three calls, all authenticated with the `X-API-Key` header:
//   1. GET  /v1/report_builder/templates       → list templates
//   2. POST /v1/report_builder/data             → data inline OR { request_id, status: IN_PROGRESS }
//   3. POST /v1/report_builder/poll             → poll until status: completed
// Gotchas (confirmed in Bruno): poll DOES carry the /v1/ prefix and DOES
// require X-API-Key (SwaggerHub omitted both → 404 / 401). The generation
// session expires 30 min after the request_id is issued.

const REPORT_BUILDER_BASE_URL = "https://api.pricelabs.co/v1/report_builder"
const FETCH_TIMEOUT = 30_000

export function isReportBuilderConfigured(): boolean {
  return !!process.env.PRICELABS_API_KEY
}

/** Optional explicit template id; otherwise resolved by name from listTemplates(). */
export function getReportBuilderTemplateId(): string | null {
  return process.env.PRICELABS_REPORT_TEMPLATE_ID || null
}

async function reportBuilderFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const apiKey = process.env.PRICELABS_API_KEY
  if (!apiKey) throw new Error("PRICELABS_API_KEY is not configured")

  const headers: Record<string, string> = { "X-API-Key": apiKey }
  if (init?.body !== undefined) headers["Content-Type"] = "application/json"

  const res = await fetch(`${REPORT_BUILDER_BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `Report Builder API error ${res.status}: ${body || res.statusText}`
    )
  }

  return res.json() as Promise<T>
}

// --- Types ---

export type ReportTemplate = {
  // PriceLabs may key the id as templateId / template_id / id, numeric or string.
  templateId?: string | number
  template_id?: string | number
  id?: string | number
  name?: string
  [key: string]: unknown
}

/** Extract the template id from a list entry regardless of field name/type. */
export function templateIdOf(t: ReportTemplate): string | null {
  const raw = t.templateId ?? t.template_id ?? t.id
  return raw == null ? null : String(raw)
}

/** Status strings seen across data/poll responses (case-insensitive in code). */
export type ReportStatus = "IN_PROGRESS" | "completed" | string

export type ReportEnvelope = {
  data?: {
    report_data?: Record<string, unknown>[]
    report_currency?: string
  } | null
  report_data?: Record<string, unknown>[]
  report_currency?: string
  request_id?: string
  status?: ReportStatus
  error_reason?: string | null
}

// --- API functions ---

export async function listTemplates(): Promise<ReportTemplate[]> {
  const data = await reportBuilderFetch<
    ReportTemplate[] | { templates?: ReportTemplate[] }
  >("/templates")
  if (Array.isArray(data)) return data
  return data.templates ?? []
}

export async function requestData(templateId: string): Promise<ReportEnvelope> {
  // Match Bruno exactly: send the id as a number when it is purely numeric.
  const template_id = /^\d+$/.test(templateId) ? Number(templateId) : templateId
  return reportBuilderFetch<ReportEnvelope>("/data", {
    method: "POST",
    body: { template_id },
  })
}

export async function pollData(requestId: string): Promise<ReportEnvelope> {
  return reportBuilderFetch<ReportEnvelope>("/poll", {
    method: "POST",
    body: { request_id: requestId },
  })
}

// --- Helpers over the envelope shape ---

export function envelopeIsInProgress(env: ReportEnvelope): boolean {
  return String(env.status ?? "").toUpperCase() === "IN_PROGRESS"
}

export function envelopeIsCompleted(env: ReportEnvelope): boolean {
  // Completed when status says so, or when report_data is present and there's
  // no in-progress marker (inline responses may omit status).
  if (String(env.status ?? "").toLowerCase() === "completed") return true
  if (envelopeIsInProgress(env)) return false
  return getReportData(env) != null
}

export function getReportData(
  env: ReportEnvelope
): Record<string, unknown>[] | null {
  const rows = env.data?.report_data ?? env.report_data
  return Array.isArray(rows) ? rows : null
}

export function getReportCurrency(env: ReportEnvelope): string | null {
  return env.data?.report_currency ?? env.report_currency ?? null
}

/**
 * Resolve the bounded "rm-listings" template id to send to /data.
 *
 * If an explicit id is configured (`PRICELABS_REPORT_TEMPLATE_ID`), trust it and
 * use it directly — exactly like the Bruno call, which POSTs to /data without
 * touching /templates. We only hit /templates to *discover* the id by name when
 * none is pinned (never falling back to a wide template — those balloon to
 * ~100 MB).
 */
export async function resolveTemplateId(): Promise<string> {
  const explicitId = getReportBuilderTemplateId()
  if (explicitId) return explicitId

  const templates = await listTemplates()
  const byName = templates.find((t) =>
    String(t.name ?? "")
      .toLowerCase()
      .includes("rm-listings")
  )
  const id = byName ? templateIdOf(byName) : null
  if (!id) {
    throw new Error(
      'Report Builder template "rm-listings" not found. Set PRICELABS_REPORT_TEMPLATE_ID to pin it.'
    )
  }
  return id
}
