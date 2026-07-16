import { Skeleton } from "@/components/ui/skeleton"

// Mirrors the AdjustmentDetail layout: header, facts, notes, history.
// Used by the full page loading.tsx and as the modal's Suspense fallback.
export function AdjustmentDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-8 w-64" />
      </div>
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  )
}
