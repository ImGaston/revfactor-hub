import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function AgentStudioLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        {[280, 520, 340].map((height) => (
          <Card key={height}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="w-full" style={{ height }} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
