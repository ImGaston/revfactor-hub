import { Skeleton } from "@/components/ui/skeleton"

export default function ListingReviewsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-[520px] w-full" />
    </div>
  )
}
