"use client"

import { BookOpen, CheckCircle, FileEdit, FolderOpen } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { KnowledgeStats } from "../_lib/types"

type StatCardProps = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  color?: string
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Icon className={`size-5 ${color ?? "text-primary"}`} />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-3xl font-semibold font-mono tracking-tight">
            {value}
          </p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function KnowledgeStatCards({ stats }: { stats: KnowledgeStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={CheckCircle}
        label="Published"
        value={stats.total_published}
        color="text-emerald-600"
      />
      <StatCard
        icon={FileEdit}
        label="Drafts"
        value={stats.total_drafts}
        color="text-amber-600"
      />
      <StatCard
        icon={FolderOpen}
        label="Categories"
        value={stats.categories_count}
        color="text-violet-600"
      />
      <StatCard
        icon={BookOpen}
        label="My Drafts"
        value={stats.my_drafts}
        color="text-sky-600"
      />
    </div>
  )
}
