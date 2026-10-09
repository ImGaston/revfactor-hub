import { beforeEach,describe,expect,it,vi } from "vitest"
const mocks=vi.hoisted(()=>({eq:vi.fn(),remove:vi.fn(),from:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:mocks.from})}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:vi.fn()}))
vi.mock("@/lib/pricelabs-sync",()=>({syncPriceLabsData:vi.fn()}))
vi.mock("@/lib/report-builder/runner",()=>({advanceReportBuilder:vi.fn()}))
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}))
import { deleteListingAction } from "@/app/(authenticated)/settings/listings/actions"
describe("Listing deletion with immutable event history",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();mocks.from.mockReturnValue({delete:mocks.remove});
    mocks.remove.mockReturnValue({eq:mocks.eq});mocks.eq.mockResolvedValue({error:null})
  })
  it("explains the snapshot foreign-key refusal without reading restricted event data or deleting history",async()=>{
    mocks.eq.mockResolvedValue({error:{code:"23503",message:'update or delete on table "listings" violates foreign key constraint "rm_event_forward_snapshots_listing_id_fkey" on table "rm_event_forward_snapshots"'}})
    expect(await deleteListingAction("listing")).toEqual({error:"This listing has event history; set it inactive instead"})
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("listings")
    expect(mocks.eq).toHaveBeenCalledExactlyOnceWith("id","listing")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([
    {code:"23503",message:"Other foreign key prevents deletion"},
    {code:"42501",message:"Permission denied"},
  ])("preserves other database failures",async(error)=>{
    mocks.eq.mockResolvedValue({error});expect(await deleteListingAction("listing")).toEqual({error:error.message})
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("keeps successful deletion for listings without protected history",async()=>{
    expect(await deleteListingAction("listing")).toEqual({error:null})
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/listings")
    expect(mocks.revalidate).toHaveBeenCalledWith("/listings")
  })
})
