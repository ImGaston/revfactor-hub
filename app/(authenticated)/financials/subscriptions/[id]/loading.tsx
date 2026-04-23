import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32 rounded-md" />
        <Skeleton className="h-8 w-72 rounded-md" />
        <Skeleton className="h-4 w-56 rounded-md" />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton className="h-[320px] rounded-lg" />
        </div>
      </div>
    </div>
  )
}
