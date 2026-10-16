import "server-only"

import { fetchHospitableReservations, listHospitableProperties } from "@/lib/hospitable-client.server"
import { parsePmsSecretPayload, type DiscoveredProperty, type PmsErrorCode, type PmsProvider } from "@/lib/pms-connections"
import type { DateWindow, NormalizedPmsReservation } from "@/lib/pms-reservations"

// Provider adapters for the PMS booking sync. The sync service only talks to
// this interface, so adding a PMS means adding an adapter here — the tables
// (pms_reservations keyed on connection + external reservation id,
// pms_sync_runs) and lib/pms-sync.server.ts stay provider-neutral.
//
// `open` turns the decrypted Vault payload into a session. A provider that
// exchanges credentials for a short-lived access token (e.g. OAuth2 client
// credentials with a daily issuance limit) does that exchange, and any token
// caching, inside its own `open`; the sync never sees how auth works.
//
// Adapters normalize provider rows into NormalizedPmsReservation from an
// allow-list of fields: no guest names, contacts, messages, door codes or
// confirmation codes ever leave an adapter.

export type PmsAdapterResult<T> = { ok: true; data: T } | { ok: false; code: PmsErrorCode }

export type FetchWindowOptions = {
  /** Absolute epoch ms; the adapter must not run requests past it. */
  deadline: number
}

export type PmsAdapterSession = {
  discoverProperties(): Promise<PmsAdapterResult<DiscoveredProperty[]>>
  /** Reservations whose check-in falls in the inclusive window, for these provider property ids. */
  fetchReservations(
    request: { propertyIds: string[]; window: DateWindow },
    options: FetchWindowOptions
  ): Promise<PmsAdapterResult<NormalizedPmsReservation[]>>
}

export type PmsAdapter = {
  provider: PmsProvider
  /** Months per fetch window (provider range limits). */
  chunkMonths: number
  open(secretPayload: string): Promise<PmsAdapterResult<PmsAdapterSession>>
}

const strip = <T>(result: { ok: true; data: T } | { ok: false; code: PmsErrorCode }): PmsAdapterResult<T> =>
  result.ok ? { ok: true, data: result.data } : { ok: false, code: result.code }

export const hospitableAdapter: PmsAdapter = {
  provider: "hospitable",
  chunkMonths: 3,
  async open(secretPayload) {
    const token = parsePmsSecretPayload(secretPayload)?.token ?? ""
    if (!token) return { ok: false, code: "invalid_token" }
    return {
      ok: true,
      data: {
        discoverProperties: async () => strip(await listHospitableProperties(token)),
        fetchReservations: async (request, options) =>
          strip(await fetchHospitableReservations(token, request, { deadline: options.deadline })),
      },
    }
  },
}

const ADAPTERS: Partial<Record<PmsProvider, PmsAdapter>> = {
  hospitable: hospitableAdapter,
}

export function getPmsAdapter(provider: string): PmsAdapter | null {
  return ADAPTERS[provider as PmsProvider] ?? null
}

export function syncableProviders(): PmsProvider[] {
  return Object.keys(ADAPTERS) as PmsProvider[]
}
