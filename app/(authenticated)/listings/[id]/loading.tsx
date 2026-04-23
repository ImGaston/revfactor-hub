import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72 rounded-md" />
        <Skeleton className="h-4 w-48 rounded-md" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Skeleton className="h-[400px] rounded-lg" />
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    </div>
  )
}
