"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, CreditCard, Ban } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { setListingSubscription } from "@/app/(authenticated)/financials/actions"

export type ListingSubscriptionOption = {
  id: string
  status: string
  customerId: string
  customerName: string | null
  planName: string | null
  amount: number
  currency: string
  interval: string | null
}

const statusColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  past_due: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  incomplete: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
}

function formatAmount(amount: number, currency: string, interval: string | null) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount)
  return `${formatted}/${interval ?? "mo"}`
}

export function ChangeListingSubscriptionDialog({
  open,
  onOpenChange,
  listingId,
  currentSubscriptionId,
  subscriptions,
  clientCustomerIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listingId: string
  currentSubscriptionId: string | null
  subscriptions: ListingSubscriptionOption[]
  clientCustomerIds: string[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(currentSubscriptionId)
  const [search, setSearch] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const clientCustomerSet = useMemo(
    () => new Set(clientCustomerIds),
    [clientCustomerIds]
  )
  const hasClientSubs = useMemo(
    () => subscriptions.some((s) => clientCustomerSet.has(s.customerId)),
    [subscriptions, clientCustomerSet]
  )

  const filtered = useMemo(() => {
    const base =
      hasClientSubs && !showAll
        ? subscriptions.filter(
            (s) =>
              clientCustomerSet.has(s.customerId) ||
              s.id === currentSubscriptionId
          )
        : subscriptions

    const statusRank: Record<string, number> = {
      active: 0,
      trialing: 1,
      past_due: 2,
      paused: 3,
      incomplete: 4,
      canceled: 5,
    }

    return base
      .filter((s) => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          (s.customerName?.toLowerCase().includes(q) ?? false) ||
          (s.planName?.toLowerCase().includes(q) ?? false) ||
          s.id.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        // Client's own subscriptions first, then by status (active first).
        const aClient = clientCustomerSet.has(a.customerId) ? 0 : 1
        const bClient = clientCustomerSet.has(b.customerId) ? 0 : 1
        if (aClient !== bClient) return aClient - bClient
        const aRank = statusRank[a.status] ?? 9
        const bRank = statusRank[b.status] ?? 9
        if (aRank !== bRank) return aRank - bRank
        return (a.customerName ?? "").localeCompare(b.customerName ?? "")
      })
  }, [
    subscriptions,
    hasClientSubs,
    showAll,
    clientCustomerSet,
    search,
    currentSubscriptionId,
  ])

  async function handleSave() {
    setSaving(true)
    const result = await setListingSubscription(listingId, selectedId)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(
      selectedId ? "Subscription updated" : "Subscription removed from listing"
    )
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change subscription</DialogTitle>
          <DialogDescription>
            Choose which Stripe subscription covers this listing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by customer, plan, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            {hasClientSubs && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                <Checkbox
                  checked={showAll}
                  onCheckedChange={(v) => setShowAll(v === true)}
                />
                Show all
              </label>
            )}
          </div>

          <ScrollArea className="h-[320px] rounded-md border p-2">
            <div className="space-y-1">
              {/* No subscription (unlink) */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50",
                  selectedId === null && "bg-primary/5"
                )}
              >
                <span className="flex size-4 items-center justify-center">
                  {selectedId === null && <Check className="size-4 text-primary" />}
                </span>
                <Ban className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm">No subscription</span>
              </button>

              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No subscriptions found
                </p>
              ) : (
                filtered.map((sub) => {
                  const isSelected = selectedId === sub.id
                  const isClientSub = clientCustomerSet.has(sub.customerId)
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSelectedId(sub.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50",
                        isSelected && "bg-primary/5"
                      )}
                    >
                      <span className="flex size-4 items-center justify-center shrink-0">
                        {isSelected && <Check className="size-4 text-primary" />}
                      </span>
                      <CreditCard className="size-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {sub.customerName ?? "Unknown customer"}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn("text-[10px]", statusColors[sub.status] ?? "")}
                          >
                            {sub.status}
                          </Badge>
                          {!isClientSub && (
                            <span className="text-[10px] text-amber-600">
                              other client
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground font-mono">
                          {formatAmount(sub.amount, sub.currency, sub.interval)} ·{" "}
                          {sub.id}
                        </p>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
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
