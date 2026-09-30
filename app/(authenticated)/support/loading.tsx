import { Skeleton } from "@/components/ui/skeleton"

export default function SupportLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      {[4, 3, 2].map((rows, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <div className="space-y-2 rounded-md border p-3">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
