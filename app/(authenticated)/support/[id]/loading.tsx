import { Skeleton } from "@/components/ui/skeleton"

export default function SupportTicketLoading() {
  return (
    <div className="flex min-h-full flex-col xl:h-full xl:flex-row">
      <div className="min-w-0 flex-1 space-y-4 p-4 lg:p-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
      <div className="shrink-0 space-y-4 border-t p-4 xl:w-80 xl:border-t-0 xl:border-l">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}
