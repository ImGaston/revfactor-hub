import { Skeleton } from "@/components/ui/skeleton"

export default function SkillDetailLoading() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-9 w-96 max-w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-36 rounded-xl" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  )
}
