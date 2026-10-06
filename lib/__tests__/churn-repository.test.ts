import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
vi.mock("server-only", () => ({}))
import { getChurnData } from "@/lib/churn.server"

function fixture(count = 1) {
  const calls: {
    table: string
    select: string
    filters: Record<string, unknown>
    from?: number
  }[] = []
  const inactive = Array.from({ length: count }, (_, i) => ({
    id: `inactive-${i}`,
    name: "Churned",
    onboarding_date: "2025-01-01",
    ending_date: "2026-10-06",
    ending_reason_tags: ["results"],
    ending_note: null,
    billing_amount: 500,
    listings: [{ city: "Austin", state: "TX" }],
  }))
  const active = [
    {
      id: "active",
      name: "Still active",
      listings: [{ city: null, state: "UT" }],
    },
  ]
  const exits = [
    {
      id: "exit",
      name: "Sold home",
      client_id: "active",
      city: null,
      state: "UT",
      deactivated_date: "2026-10-06",
      exit_reason: "sold_property",
      exit_note: null,
      exit_handled_by: "Team",
      stripe_item_status: "adjusted",
      clients: { name: "Still active", status: "active" },
    },
  ]
  const leaving = [
    {
      client_id: "active",
      subscription_id: "one",
      scheduled_end: "2026-10-31",
      synced_at: "2026-10-06",
    },
    {
      client_id: "active",
      subscription_id: "two",
      scheduled_end: "2026-11-30",
      synced_at: "2026-10-06",
    },
    {
      client_id: "gone",
      subscription_id: "hidden",
      scheduled_end: "2026-10-31",
      synced_at: "2026-10-06",
    },
  ]
  const builder = (table: string) => {
    const call = { table, select: "", filters: {} } as (typeof calls)[number]
    calls.push(call)
    const query = {
      select(value: string) {
        call.select = value
        return query
      },
      eq(key: string, value: unknown) {
        call.filters[key] = value
        return query
      },
      order() {
        return query
      },
      returns() {
        return query
      },
      range(from: number, to: number) {
        call.from = from
        const rows =
          table === "clients"
            ? call.filters.status === "inactive"
              ? inactive
              : active
            : table === "listings"
              ? exits
              : leaving
        return Object.assign(
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
          {
            returns: () =>
              Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
          }
        )
      },
    }
    return query
  }
  return {
    calls,
    db: { from: builder, rpc: builder } as unknown as SupabaseClient,
  }
}
describe("churn repository", () => {
  it("queries the correct cohorts and excludes financial props for admins", async () => {
    const { db, calls } = fixture()
    const result = await getChurnData(db, false)
    expect(calls.find((call) => call.table === "listings")?.filters).toEqual({
      status: "inactive",
      "clients.status": "active",
    })
    expect(
      calls.find((call) => call.filters.status === "inactive")?.select
    ).not.toContain("billing_amount")
    expect(result.clients[0]).not.toHaveProperty("billing_amount")
    expect(result.exits[0]).toMatchObject({
      client_name: "Still active",
      markets: ["UT"],
      exit_reason: "sold_property",
    })
    expect(result.leaving).toHaveLength(1)
    expect(result.leaving[0].cancellations).toHaveLength(2)
  })
  it("fetches all pages rather than truncating SQL counts", async () => {
    const { db, calls } = fixture(501)
    expect((await getChurnData(db, false)).clients).toHaveLength(501)
    expect(
      calls
        .filter(
          (call) =>
            call.filters.status === "inactive" && call.table === "clients"
        )
        .map((call) => call.from)
    ).toEqual([0, 500])
  })
  it("includes billing only for a super-admin caller", async () => {
    const { db, calls } = fixture()
    expect((await getChurnData(db, true)).clients[0].billing_amount).toBe(500)
    expect(
      calls.find((call) => call.filters.status === "inactive")?.select
    ).toContain("billing_amount")
  })
})
