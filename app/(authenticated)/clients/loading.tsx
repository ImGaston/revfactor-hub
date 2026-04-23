import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-4 w-32 rounded-md" />
        </div>
        <Skeleton className="h-9 w-[140px] rounded-md" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 flex-1 min-w-[200px] rounded-md" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-3">
          <Skeleton className="h-4 w-full rounded-md" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-[18%] rounded-md" />
              <Skeleton className="h-4 w-[22%] rounded-md" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-md" />
              <Skeleton className="h-4 w-8 rounded-md" />
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="h-4 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
