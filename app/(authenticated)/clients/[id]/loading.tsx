import { Skeleton } from "@/components/ui/skeleton"

// Matches the tabs shell: back link, name + status, tab bar, then the Legacy
// tab (the default). Other tabs show their own skeleton while they load.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-7 w-64 rounded-md" />
      </div>

      <Skeleton className="h-9 w-full max-w-xl rounded-full" />

      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-24 rounded-md" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
