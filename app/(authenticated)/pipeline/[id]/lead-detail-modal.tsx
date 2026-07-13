"use client"

import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

// Dialog shell for the intercepted lead detail route. Closing (ESC, click
// outside, the header X inside LeadDetail) navigates back to the board.
export function LeadDetailModal({ children }: { children: React.ReactNode }) {
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
        className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"
      >
        <DialogTitle className="sr-only">Lead detail</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
