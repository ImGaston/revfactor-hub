"use client"

import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

// Dialog shell for the intercepted adjustment detail route. Closing (ESC,
// click outside) navigates back to the queue.
export function AdjustmentDetailModal({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back()
      }}
    >
      {/* The glass surface is painted by a ::before sized to the padding box, so
          the DialogContent itself must not scroll: an inner wrapper scrolls and
          the surface always covers the full modal. */}
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">Adjustment detail</DialogTitle>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
