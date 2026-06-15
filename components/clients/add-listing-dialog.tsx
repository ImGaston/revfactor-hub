"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  ListingFormFields,
  EMPTY_LISTING_VALUES,
  buildListingFields,
  type ListingFormValues,
} from "@/components/listings/listing-form-fields"
import { createListingAction } from "@/app/(authenticated)/settings/listings/actions"

export function AddListingDialog({
  open,
  onOpenChange,
  clientId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string
}) {
  const [values, setValues] = useState<ListingFormValues>({
    ...EMPTY_LISTING_VALUES,
  })
  const [saving, setSaving] = useState(false)

  function reset() {
    setValues({ ...EMPTY_LISTING_VALUES })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) {
      toast.error("Name is required")
      return
    }

    setSaving(true)
    const result = await createListingAction({
      client_id: clientId,
      status: "active",
      ...buildListingFields(values),
    })
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Listing created")
      reset()
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Listing</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ListingFormFields
            values={values}
            onChange={setValues}
            idPrefix="new-listing"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
