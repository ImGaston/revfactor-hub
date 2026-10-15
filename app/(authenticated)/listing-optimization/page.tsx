import Link from "next/link"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ownerSendGroups } from "@/lib/listing-optimization"
import { loadStaffReports } from "@/lib/listing-optimization.server"
import { ReviewsBoard } from "./reviews-board"

export default async function ListingOptimizationPage() {
  const reports = await loadStaffReports()
  const groups = ownerSendGroups(reports)

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Listing reviews</h1>
        <p className="text-sm text-muted-foreground">
          Audit suggestions shared with owners in the Assembly portal. Drafts come from the audit
          skill; publishing approves every suggestion in the review. Owner accepts land in
          Adjustments as Listing Content.
        </p>
      </div>
      {groups.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Send by owner</h2>
            <p className="text-xs text-muted-foreground">
              These owners have more than one review waiting. Publish them together and send one
              message instead of one per listing.
            </p>
          </div>
          <ul className="divide-y">
            {groups.map((g) => (
              <li key={g.clientId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{g.clientName ?? "Unknown client"}</span>
                <span className="text-sm text-muted-foreground">{g.reportIds.length} reviews</span>
                <Button asChild size="sm" variant="outline" className="ml-auto">
                  <Link href={`/listing-optimization/owner/${g.clientId}`}>
                    <Send className="size-4" />
                    Send to owner
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReviewsBoard rows={reports} ownerSendClientIds={groups.map((g) => g.clientId)} />
    </div>
  )
}
