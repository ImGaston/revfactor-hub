import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36 rounded-md" />
        <Skeleton className="h-4 w-32 rounded-md" />
      </div>

      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-4 w-72 rounded-md" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 flex-1 min-w-[200px] max-w-sm rounded-md" />
        <Skeleton className="h-9 w-[220px] rounded-md" />
        <Skeleton className="h-9 w-[220px] rounded-md" />
        <Skeleton className="h-9 w-[340px] rounded-md" />
      </div>

      <div className="rounded-md border w-full overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-3">
          <Skeleton className="h-4 w-full rounded-md" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-[90px] rounded-md" />
              <Skeleton className="h-4 w-[90px] rounded-md" />
              <Skeleton className="h-4 w-[90px] rounded-md" />
              <Skeleton className="h-4 w-10 rounded-md" />
              <Skeleton className="h-4 flex-1 rounded-md" />
              <Skeleton className="h-4 w-[140px] rounded-md" />
              <Skeleton className="h-4 w-[90px] rounded-md" />
              <Skeleton className="h-4 w-[70px] rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-48 rounded-md" />
        <Skeleton className="h-8 w-56 rounded-md" />
      </div>
    </div>
  )
}
