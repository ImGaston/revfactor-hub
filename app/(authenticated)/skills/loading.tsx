import { Skeleton } from "@/components/ui/skeleton"

export default function SkillsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
