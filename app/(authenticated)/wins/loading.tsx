import { Skeleton } from "@/components/ui/skeleton"

export default function WinsLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {[120, 120, 140, 110, 100].map((w, i) => (
          <Skeleton key={i} className="h-9 rounded-md" style={{ width: w }} />
        ))}
      </div>

      <div className="rounded-xl border">
        <Skeleton className="h-11 w-full rounded-t-xl" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t px-4 py-3">
            <Skeleton className="h-4 w-[18%]" />
            <Skeleton className="h-4 w-[26%]" />
            <Skeleton className="h-4 w-[12%]" />
            <Skeleton className="h-4 w-[22%]" />
            <Skeleton className="h-4 w-[10%]" />
          </div>
        ))}
      </div>
    </div>
  )
}
