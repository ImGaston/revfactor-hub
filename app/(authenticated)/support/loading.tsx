import { Skeleton } from "@/components/ui/skeleton"

// Shown in the workspace's main column while a page under /support loads.
export default function SupportLoading() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  )
}
