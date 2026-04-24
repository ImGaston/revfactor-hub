"use client"

import { useState } from "react"
import { Building2, Check } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { linkSubscriptionToListings } from "./actions"

type ClientRef = { id: string; name: string; email: string | null; stripe_customer_id: string | null }
type ListingRef = { id: string; name: string; client_id: string; stripe_subscription_id: string | null; clients: { id: string; name: string } | null }

export function LinkSubscriptionDialog({
  open,
  onOpenChange,
  subscriptionId,
  customerId,
  planName,
  listings,
  clients,
  clientStripeCustomers,
  currentListingIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscriptionId: string
  customerId: string
  planName: string | null
  listings: ListingRef[]
  clients: ClientRef[]
  clientStripeCustomers: { client_id: string; stripe_customer_id: string }[]
  currentListingIds: string[]
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentListingIds))
  const [search, setSearch] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)

  // Resolve the Hub client for this Stripe customer via the junction table.
  const linkedClientId = clientStripeCustomers.find(
    (r) => r.stripe_customer_id === customerId,
  )?.client_id
  const linkedClient = linkedClientId
    ? clients.find((c) => c.id === linkedClientId) ?? null
    : null

  // When a client is linked, restrict the picker to that client's listings (UX
  // requirement). User can opt-in to "show all" if they need to override.
  const baseListings =
    linkedClient && !showAll
      ? listings.filter((l) => l.client_id === linkedClient.id)
      : listings

  const filteredListings = baseListings
    .filter((l) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        l.name.toLowerCase().includes(q) ||
        (l.clients?.name.toLowerCase().includes(q) ?? false)
      )
    })
    .sort((a, b) => {
      // Client's listings first when "show all" is on, then alphabetical.
      const aIsClient = linkedClient && a.client_id === linkedClient.id ? 0 : 1
      const bIsClient = linkedClient && b.client_id === linkedClient.id ? 0 : 1
      if (aIsClient !== bIsClient) return aIsClient - bIsClient
      return a.name.localeCompare(b.name)
    })

  function toggleListing(listingId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(listingId)) {
        next.delete(listingId)
      } else {
        next.add(listingId)
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const result = await linkSubscriptionToListings(subscriptionId, [...selectedIds])
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Linked ${selectedIds.size} listing${selectedIds.size !== 1 ? "s" : ""} to subscription`)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Listings to Subscription</DialogTitle>
          <DialogDescription>
            Select which listings are covered by this subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Subscription info */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-medium">{planName ?? "Subscription"}</p>
            <p className="text-xs text-muted-foreground font-mono">{subscriptionId}</p>
            {linkedClient && (
              <p className="text-xs text-muted-foreground">Client: {linkedClient.name}</p>
            )}
          </div>

          {/* Search + show-all toggle (only when client is linked) */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search listings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            {linkedClient && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                <Checkbox
                  checked={showAll}
                  onCheckedChange={(v) => setShowAll(v === true)}
                />
                Show all listings
              </label>
            )}
          </div>
          {linkedClient && !showAll && (
            <p className="text-xs text-muted-foreground">
              Showing only listings of <span className="font-medium">{linkedClient.name}</span>.
            </p>
          )}

          {/* Listing checkboxes */}
          <ScrollArea className="h-[280px] rounded-md border p-2">
            {filteredListings.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                No listings found
              </p>
            ) : (
              <div className="space-y-1">
                {filteredListings.map((listing) => {
                  const isSelected = selectedIds.has(listing.id)
                  const isOtherSub = listing.stripe_subscription_id && listing.stripe_subscription_id !== subscriptionId
                  return (
                    <label
                      key={listing.id}
                      className={`flex items-center gap-3 rounded-md px-2 py-1.5 cursor-pointer transition-colors hover:bg-muted/50 ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleListing(listing.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{listing.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate ml-5">
                          {listing.clients?.name ?? "No client"}
                          {isOtherSub && (
                            <span className="text-amber-600 ml-1">(linked to another subscription)</span>
                          )}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          <p className="text-xs text-muted-foreground text-center">
            {selectedIds.size} listing{selectedIds.size !== 1 ? "s" : ""} selected
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
