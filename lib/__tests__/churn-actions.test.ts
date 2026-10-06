import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("@/lib/permissions.server", () => ({ hasPermission: mocks.permission }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { tagListingExitAction } from "@/app/(authenticated)/churn/actions"
const input = {
  listingId: "a6631aaf-3b5f-477b-8a60-d59a69927d75",
  reason: "sold_property",
  note: " Sold ",
  handledBy: "Team",
  stripeItemStatus: "adjusted",
  status: "inactive",
  clientStatus: "inactive",
}

describe("tagListingExitAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue(true)
    mocks.rpc.mockResolvedValue({ data: input.listingId, error: null })
  })
  it("writes only exit metadata through the atomic RPC", async () => {
    expect(await tagListingExitAction(input)).toEqual({ error: null })
    expect(mocks.rpc).toHaveBeenCalledWith("tag_listing_exit", {
      p_listing_id: input.listingId,
      p_reason: "sold_property",
      p_note: "Sold",
      p_handled_by: "Team",
      p_stripe_item_status: "adjusted",
    })
    expect(mocks.revalidate).toHaveBeenCalledWith("/churn")
  })
  it.each(["churn:edit", "churn:view", "listings:edit", "clients:view"])(
    "denies writes without %s",
    async (denied) => {
      mocks.permission.mockImplementation(
        async (resource, action) => `${resource}:${action}` !== denied
      )
      expect((await tagListingExitAction(input)).error).toMatch(
        /Not authorized/
      )
      expect(mocks.rpc).not.toHaveBeenCalled()
    }
  )
  it("rejects malformed submissions before database writes", async () => {
    expect(
      (await tagListingExitAction({ ...input, reason: "unknown" })).error
    ).not.toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("surfaces a stale listing or permission error without reporting success", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Listing is no longer an inactive listing of an active client",
      },
    })
    expect((await tagListingExitAction(input)).error).toContain("no longer")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
