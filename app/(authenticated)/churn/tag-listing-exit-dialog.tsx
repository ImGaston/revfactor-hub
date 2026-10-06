"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { CLIENT_CHURN_REASONS } from "@/lib/clients"
import {
  listingExitSchema,
  type ListingExit,
  type StripeItemStatus,
} from "@/lib/churn"
import { tagListingExitAction } from "./actions"

export function TagListingExitDialog({
  listing,
  onClose,
}: {
  listing: ListingExit
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState(listing.exit_reason ?? "")
  const [note, setNote] = useState(listing.exit_note ?? "")
  const [handledBy, setHandledBy] = useState(listing.exit_handled_by ?? "")
  const [stripeItemStatus, setStripeItemStatus] = useState<StripeItemStatus>(
    listing.stripe_item_status
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = listingExitSchema.safeParse({
      listingId: listing.id,
      reason,
      note,
      handledBy,
      stripeItemStatus,
    })
    if (!parsed.success) {
      setError("Choose an exit reason and check the field lengths.")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await tagListingExitAction(parsed.data)
        if (result.error) {
          setError(result.error)
          toast.error(result.error)
          return
        }
        toast.success("Listing exit saved")
        router.refresh()
        onClose()
      } catch {
        setError("Could not save this exit. Please try again.")
        toast.error("Could not save listing exit")
      }
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag listing exit</DialogTitle>
          <DialogDescription>
            {listing.name} · {listing.client_name} stays active.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={!!error && !reason}>
              <FieldLabel htmlFor="exit-reason">Exit reason</FieldLabel>
              <Select
                value={reason}
                onValueChange={setReason}
                disabled={pending}
              >
                <SelectTrigger
                  id="exit-reason"
                  aria-invalid={!!error && !reason}
                >
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CLIENT_CHURN_REASONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="exit-note">Note</FieldLabel>
              <Textarea
                id="exit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
                rows={3}
                disabled={pending}
                placeholder="What happened, and what has been handled?"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exit-handled-by">Handled by</FieldLabel>
              <Input
                id="exit-handled-by"
                value={handledBy}
                onChange={(e) => setHandledBy(e.target.value)}
                maxLength={120}
                disabled={pending}
                placeholder="Team member name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exit-stripe-status">
                Stripe item status
              </FieldLabel>
              <Select
                value={stripeItemStatus}
                onValueChange={(value) =>
                  setStripeItemStatus(value as StripeItemStatus)
                }
                disabled={pending}
              >
                <SelectTrigger id="exit-stripe-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="adjusted">Adjusted</SelectItem>
                    <SelectItem value="n/a">Not applicable</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Manual tracking only. Saving does not update Stripe.
              </FieldDescription>
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}Save exit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
