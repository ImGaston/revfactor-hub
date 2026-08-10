import { Skeleton } from "@/components/ui/skeleton"

export default function RevenueBriefsLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Skeleton className="h-[680px] w-full" />
        <Skeleton className="h-[680px] w-full" />
      </div>
    </div>
  )
}
