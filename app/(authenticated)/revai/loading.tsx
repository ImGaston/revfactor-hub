import { Skeleton } from "@/components/ui/skeleton"

export default function RevAiLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] gap-6">
      <div className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="flex-1 rounded-2xl" />
        <Skeleton className="mx-auto h-24 w-full max-w-3xl rounded-2xl" />
      </div>
    </div>
  )
}
