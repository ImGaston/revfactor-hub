import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-28 rounded-md" />
        <Skeleton className="h-4 w-36 rounded-md" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 flex-1 min-w-[200px] max-w-sm rounded-md" />
        <Skeleton className="h-9 w-[180px] rounded-md" />
        <Skeleton className="h-9 w-[180px] rounded-md" />
        <Skeleton className="h-9 w-[220px] rounded-md" />
      </div>

      <div className="rounded-md border w-full overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-3">
          <Skeleton className="h-4 w-full rounded-md" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 flex-1 rounded-md" />
              <Skeleton className="h-4 w-[180px] rounded-md" />
              <Skeleton className="h-4 w-[100px] rounded-md" />
              <Skeleton className="h-4 w-8 rounded-md" />
              <Skeleton className="h-4 w-12 rounded-md" />
              <Skeleton className="h-4 w-12 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
