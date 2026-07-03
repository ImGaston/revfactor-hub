import { Skeleton } from "@/components/ui/skeleton"

export default function AdjustmentsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      {[6, 3, 2].map((rows, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <div className="space-y-2 rounded-md border p-3">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
