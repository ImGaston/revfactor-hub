import { describe, it, expect, vi } from "vitest"
vi.mock("server-only", () => ({}))
import {
  monthlyResult,
  confirmedBalances,
  monthsEnding,
} from "@/lib/financial-scorecard/calculations"
import {
  subscriptionMrr,
  buildMrrDetails,
  type SubscriptionInput,
} from "@/lib/financial-scorecard/mrr"
import { captureMrr } from "@/lib/financial-scorecard/snapshot.server"
import { allRows } from "@/lib/financial-scorecard/repository.server"
import type {
  ScorecardData,
  BankRow,
  ExpenseRow,
} from "@/lib/financial-scorecard/types"
import type { SupabaseClient } from "@supabase/supabase-js"
const base = (): ScorecardData => ({
  revision: 0,
  payouts: [
    {
      id: "p1",
      amount_cents: 100000,
      currency: "usd",
      status: "paid",
      arrival_date: "2026-08-20",
    },
  ],
  bank: [],
  expenses: [],
  accounts: [],
  categories: [],
  balances: [],
  reviews: [],
  snapshots: [],
  activeClients: 2,
  activeListings: 10,
  loadedAt: "2026-09-11T00:00:00Z",
})
const bank = (patch: Partial<BankRow> = {}): BankRow => ({
  id: "b1",
  account_id: "a",
  txn_date: "2026-08-20",
  payee: "Customer",
  amount_cents: 10000,
  currency: "usd",
  direction: "in",
  flow_class: "external_income",
  matched_payout_id: null,
  expense_id: null,
  counterparty_account: null,
  income_treatment: "operating",
  income_reviewed_at: "2026-09-11",
  ...patch,
})
const expense = (patch: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id: "e1",
  description: "Cost",
  amount: 100,
  date: "2026-07-01",
  is_paid: true,
  paid_at: "2026-08-02",
  category_id: null,
  bank_transaction_id: null,
  financial_treatment: "operating",
  financial_reviewed_at: null,
  ...patch,
})
const sub = (patch: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  id: "s",
  customer: "c",
  status: "active",
  discounts: [],
  items: {
    data: [
      {
        quantity: 2,
        price: {
          unit_amount: 32000,
          currency: "usd",
          product: "prod",
          recurring: { interval: "month" },
        },
      },
    ],
  },
  ...patch,
})
describe("owner cash scorecard", () => {
  it("uses previous calendar month even in January", () =>
    expect(monthsEnding("2026-01", 2)).toEqual(["2025-12", "2026-01"]))
  it("never doubles bank deposits of Stripe, matched or identifiable", () => {
    const d = base()
    d.bank = [
      bank({ matched_payout_id: "p1" }),
      bank({ id: "b2", payee: "STRIPE" }),
      bank({ id: "b3" }),
    ]
    expect(monthlyResult(d, "2026-08").revenue).toBe(110000)
  })
  it("excludes unreviewed/capital/transfers", () => {
    const d = base()
    d.bank = [
      bank({ income_reviewed_at: null }),
      bank({ income_treatment: "capital" }),
      bank({ flow_class: "internal_transfer" }),
    ]
    expect(monthlyResult(d, "2026-08").other).toBe(0)
  })
  it("uses effective payment date and excludes distributions and unpaid expenses", () => {
    const d = base()
    d.expenses = [
      expense(),
      expense({ id: "e2", financial_treatment: "partner_distribution" }),
      expense({ id: "e3", is_paid: false, date: "2026-08-01" }),
    ]
    const r = monthlyResult(d, "2026-08")
    expect(r.expenses).toBe(10000)
    expect(r.pending).toBe(10000)
    expect(r.result).toBe(90000)
    expect(monthlyResult(d, "2026-07").expenses).toBe(0)
  })
  it("keeps a real business expense paid by a partner in the result", () => {
    const d = base()
    d.accounts = [
      {
        id: "a",
        label: "Partner",
        role: "partner",
        is_internal: true,
        account_number: "1",
      },
    ]
    d.bank = [
      bank({
        direction: "out",
        flow_class: "external_expense",
        expense_id: "e1",
        amount_cents: -10000,
      }),
    ]
    d.expenses = [expense({ bank_transaction_id: "b1" })]
    const r = monthlyResult(d, "2026-08")
    expect(r.expenses).toBe(10000)
    expect(r.withdrawals).toBe(0)
    expect(r.expensePending).toHaveLength(1)
  })
  it("does not show a 100% margin when costs are missing", () => {
    expect(monthlyResult(base(), "2026-08").margin).toBeNull()
  })
  it("allows explicitly reviewed zero-expense months", () => {
    const d = base()
    d.reviews = [{ month: "2026-08-01", reviewed_at: "2026-09-11" }]
    expect(monthlyResult(d, "2026-08").margin).toBe(100)
  })
  it("is independent of current listing/client count", () => {
    const d = base()
    d.expenses = [expense()]
    const before = monthlyResult(d, "2026-08")
    d.activeClients = 0
    d.activeListings = 0
    expect(monthlyResult(d, "2026-08")).toEqual(before)
  })
  it("does not sum balances at different dates", () => {
    const accounts = ["a", "b"].map((id) => ({
      id,
      label: id,
      role: "opex",
      is_internal: true,
      account_number: id,
    }))
    const balances = accounts.map((a, i) => ({
      id: a.id,
      account_id: a.id,
      effective_date: `2026-0${7 + i}-31`,
      created_at: "2026-09-01",
      amount_cents: 100,
    }))
    expect(confirmedBalances(accounts, balances, "2026-09-01").total).toBeNull()
    balances[0].effective_date = "2026-08-31"
    expect(confirmedBalances(accounts, balances, "2026-09-01").total).toBe(200)
  })
})
describe("MRR observations", () => {
  it("uses decimal unit prices without invoice estimates", () => {
    const s = sub()
    s.items.data[0].price!.unit_amount = null
    s.items.data[0].price!.unit_amount_decimal = "14285.7"
    s.items.data[0].quantity = 7
    expect(subscriptionMrr(s, 0)).toBe(100000)
  })
  it("applies quantity", () => expect(subscriptionMrr(sub(), 0)).toBe(64000))
  it("normalizes annual and multi-month prices", () => {
    const s = sub()
    s.items.data[0].price!.recurring = { interval: "year", interval_count: 2 }
    expect(subscriptionMrr(s, 0)).toBe(2667)
  })
  it("applies active percentage discounts and ignores expired ones", () =>
    expect(
      subscriptionMrr(
        sub({
          discounts: [
            { end: 50, coupon: { percent_off: 100 } },
            { coupon: { percent_off: 25 } },
          ],
        }),
        100
      )
    ).toBe(48000))
  it("applies fixed subscription discounts only once", () => {
    const s = sub({
      discounts: [{ coupon: { amount_off: 1000, currency: "usd" } }],
    })
    s.items.data.push({ ...s.items.data[0] })
    expect(subscriptionMrr(s, 0)).toBe(127000)
  })
  it("excludes one-time prices and canceled subscriptions", () => {
    const s = sub()
    s.items.data.push({
      price: { unit_amount: 15000, currency: "usd", recurring: null },
    })
    expect(subscriptionMrr(s, 0)).toBe(64000)
    s.status = "canceled"
    expect(subscriptionMrr(s, 0)).toBe(0)
  })
  it("rejects unresolved discounts and metered prices rather than guessing", () => {
    expect(() => subscriptionMrr(sub({ discounts: ["di"] }), 0)).toThrow()
    const s = sub()
    s.items.data[0].price!.recurring!.usage_type = "metered"
    expect(() => subscriptionMrr(s, 0)).toThrow()
  })
  it("recognizes past due and excludes test clients", () => {
    const inputs = [
      sub(),
      sub({ id: "other", customer: "test", status: "past_due" }),
    ]
    const rows = buildMrrDetails(
      inputs,
      [
        { client_id: "a", stripe_customer_id: "c" },
        { client_id: "t", stripe_customer_id: "test" },
      ],
      [
        { id: "a", status: "active" },
        { id: "t", status: "test" },
      ],
      0
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].client_id).toBe("a")
  })
  it("preserves an unresolved customer as pending, without guessing", () =>
    expect(buildMrrDetails([sub()], [], [], 0)[0]).toMatchObject({
      client_id: null,
      mrr_cents: 64000,
      reason: expect.any(String),
    }))
  it("multiple subscriptions can resolve to one client", () => {
    const rows = buildMrrDetails(
      [sub(), sub({ id: "s2", status: "past_due" })],
      [{ client_id: "a", stripe_customer_id: "c" }],
      [{ id: "a", status: "active" }],
      0
    )
    expect(new Set(rows.map((r) => r.client_id)).size).toBe(1)
    expect(rows.reduce((s, r) => s + r.mrr_cents!, 0)).toBe(128000)
  })
})
describe("paginated reads", () => {
  it("loads more than 1000 records in stable bounded pages", async () => {
    const values = Array.from({ length: 1980 }, (_, id) => ({ id }))
    const range = vi.fn(async (from: number, to: number) => ({
      data: values.slice(from, to + 1),
      error: null,
    }))
    const db = {
      from: () => ({ select: () => ({ order: () => ({ range }) }) }),
    } as unknown as SupabaseClient
    expect(await allRows(db, "ledger")).toHaveLength(1980)
    expect(range).toHaveBeenCalledTimes(4)
  })
  it("fails the whole read if any page fails", async () => {
    const db = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async () => ({ data: null, error: { message: "failed" } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(allRows(db, "ledger")).rejects.toThrow("failed")
  })
})

describe("failed subscription sync", () => {
  it("records a failed observation without publishing a partial total", async () => {
    const insert = vi.fn(async (value: unknown) => {
      void value
      return { error: null }
    })
    const db = { from: () => ({ insert }) } as unknown as SupabaseClient
    await captureMrr(
      db,
      {} as Parameters<typeof captureMrr>[1],
      [],
      ["Stripe page failed"]
    )
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        details: [],
        error: "Stripe page failed",
      })
    )
    expect(insert.mock.calls[0][0]).not.toHaveProperty("mrr_cents")
  })
})
