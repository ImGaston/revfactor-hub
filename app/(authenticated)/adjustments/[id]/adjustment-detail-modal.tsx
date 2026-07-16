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
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">Adjustment detail</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
