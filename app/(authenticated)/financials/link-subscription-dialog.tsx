"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Plus } from "lucide-react"
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
import {
  ListingFormFields,
  EMPTY_LISTING_VALUES,
  buildListingFields,
  type ListingFormValues,
} from "@/components/listings/listing-form-fields"
import type { StripeSubscriptionSummary } from "@/lib/stripe"
import { createListingForClient, linkSubscriptionToListings } from "./actions"

type ClientRef = {
  id: string
  name: string
  email: string | null
  stripe_customer_id: string | null
}
type ListingRef = {
  id: string
  name: string
  client_id: string
  stripe_subscription_id: string | null
  clients: { id: string; name: string } | null
}

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
  subscriptions = [],
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
  subscriptions?: StripeSubscriptionSummary[]
}) {
  // Resolve a listing's *other* subscription to a human label so the user knows
  // exactly which subscription a listing is currently attached to.
  const subById = new Map(subscriptions.map((s) => [s.id, s]))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(currentListingIds)
  )
  const [search, setSearch] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newListing, setNewListing] = useState<ListingFormValues>({
    ...EMPTY_LISTING_VALUES,
  })
  const [creating, setCreating] = useState(false)
  const router = useRouter()

  function resetNewListing() {
    setNewListing({ ...EMPTY_LISTING_VALUES })
  }

  // Resolve the Hub client for this Stripe customer via the junction table.
  const linkedClientId = clientStripeCustomers.find(
    (r) => r.stripe_customer_id === customerId
  )?.client_id
  const linkedClient = linkedClientId
    ? (clients.find((c) => c.id === linkedClientId) ?? null)
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

  async function handleCreateListing(event: React.FormEvent) {
    event.preventDefault()
    if (!linkedClient) return
    if (!newListing.name.trim()) {
      toast.error("Name is required")
      return
    }
    setCreating(true)
    const fields = buildListingFields(newListing)
    const result = await createListingForClient({
      clientId: linkedClient.id,
      name: fields.name,
      listingId: fields.listing_id,
      pricelabsLink: fields.pricelabs_link,
      airbnbLink: fields.airbnb_link,
      city: fields.city,
      state: fields.state,
    })
    setCreating(false)
    if (result.error || !result.listingId) {
      toast.error(result.error ?? "Could not create listing")
      return
    }
    // Auto-select the new listing and refresh so it appears in the list.
    setSelectedIds((prev) => new Set(prev).add(result.listingId!))
    resetNewListing()
    setAddOpen(false)
    toast.success("Listing created and selected")
    router.refresh()
  }

  async function handleSave() {
    setSaving(true)
    const result = await linkSubscriptionToListings(subscriptionId, [
      ...selectedIds,
    ])
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(
        `Linked ${selectedIds.size} listing${selectedIds.size !== 1 ? "s" : ""} to subscription`
      )
      onOpenChange(false)
      // The Overview and Subscriptions tabs share the listings snapshot loaded
      // by the parent Server Component. Refresh it after saving so switching
      // tabs immediately reflects the new assignment.
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Listings to Subscription</DialogTitle>
          <DialogDescription>
            Select which listings are covered by this subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto py-2">
          {/* Subscription info */}
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">{planName ?? "Subscription"}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {subscriptionId}
            </p>
            {linkedClient && (
              <p className="text-xs text-muted-foreground">
                Client: {linkedClient.name}
              </p>
            )}
          </div>

          {/* Quick-add a listing already associated to the linked client */}
          {linkedClient && (
            <div className="rounded-md border p-3">
              {!addOpen ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="size-4" />
                  New listing for {linkedClient.name}
                </Button>
              ) : (
                <form onSubmit={handleCreateListing} className="space-y-3">
                  <ListingFormFields
                    values={newListing}
                    onChange={setNewListing}
                    idPrefix="qa-listing"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAddOpen(false)
                        resetNewListing()
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={creating}>
                      {creating ? "Creating..." : "Create & select"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Search + show-all toggle (only when client is linked) */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search listings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 flex-1 text-sm"
            />
            {linkedClient && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
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
              Showing only listings of{" "}
              <span className="font-medium">{linkedClient.name}</span>.
            </p>
          )}

          {/* Listing checkboxes */}
          <ScrollArea className="h-[280px] rounded-md border p-2">
            {filteredListings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No listings found
              </p>
            ) : (
              <div className="space-y-1">
                {filteredListings.map((listing) => {
                  const isSelected = selectedIds.has(listing.id)
                  const isOtherSub =
                    listing.stripe_subscription_id &&
                    listing.stripe_subscription_id !== subscriptionId
                  const otherSub = isOtherSub
                    ? subById.get(listing.stripe_subscription_id!)
                    : undefined
                  const otherSubLabel = otherSub
                    ? `${otherSub.customerName ?? otherSub.planName ?? "subscription"} · ${otherSub.status}`
                    : listing.stripe_subscription_id
                  return (
                    <label
                      key={listing.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50 ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleListing(listing.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm">
                            {listing.name}
                          </span>
                        </div>
                        <p className="ml-5 truncate text-xs text-muted-foreground">
                          {listing.clients?.name ?? "No client"}
                          {isOtherSub && (
                            <span className="ml-1 text-amber-600">
                              (linked to {otherSubLabel})
                            </span>
                          )}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          <p className="text-center text-xs text-muted-foreground">
            {selectedIds.size} listing{selectedIds.size !== 1 ? "s" : ""}{" "}
            selected
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
