import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  profile: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("@/lib/permissions.server", () => ({ hasPermission: mocks.permission }))
vi.mock("@/lib/supabase/profile", () => ({ getProfile: mocks.profile }))
vi.mock("@/lib/assembly", () => ({
  isAssemblyConfigured: () => false,
  searchAssemblyClientByEmail: vi.fn(),
  assemblyClientMessagesUrl: vi.fn(),
  assemblyCompanyMessagesUrl: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: mocks.update,
      select: () => ({
        eq: () => ({ single: async () => ({ data: { status: "inactive" } }) }),
      }),
    }),
  }),
}))
import { updateClientAction } from "@/app/(authenticated)/settings/clients/actions"

const input = {
  name: "Client",
  email: null,
  status: "inactive",
  assembly_link: null,
  onboarding_date: "2025-01-01",
  ending_date: "2026-10-06",
  billing_amount: null,
  autopayment_set_up: false,
  stripe_dashboard: null,
  pms_name: null,
  has_vrbo: false,
  billing_entity: "revfactor",
  ending_reason_tags: ["results"],
  ending_note: "Churn note",
}
describe("Settings client churn edits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue(true)
    mocks.profile.mockResolvedValue({ role: "admin" })
    mocks.update.mockReturnValue({ eq: async () => ({ error: null }) })
  })
  it("lets authorized admins edit churn without clearing hidden financial data", async () => {
    expect(await updateClientAction("client", { ...input })).toEqual({
      error: null,
    })
    const saved = mocks.update.mock.calls[0][0]
    expect(saved).toMatchObject({
      ending_reason_tags: ["results"],
      ending_note: "Churn note",
      ending_date: "2026-10-06",
    })
    for (const field of [
      "billing_amount",
      "autopayment_set_up",
      "stripe_dashboard",
    ])
      expect(saved).not.toHaveProperty(field)
  })
  it("preserves reason fields for users without churn edit permission", async () => {
    mocks.permission.mockResolvedValue(false)
    await updateClientAction("client", { ...input })
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty(
      "ending_reason_tags"
    )
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("ending_note")
  })
  it("still uses the shared inactive-to-active patch to clear obsolete churn", async () => {
    await updateClientAction("client", {
      ...input,
      status: "active",
      ending_date: "2027-01-01",
    })
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      ending_date: null,
      ending_reason_tags: [],
      ending_note: null,
    })
  })
})
