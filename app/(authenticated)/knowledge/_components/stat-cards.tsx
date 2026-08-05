"use client"

import {
  Bot,
  CheckCircle,
  FileEdit,
  FolderOpen,
  ShieldCheck,
  UserRound,
} from "lucide-react"
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
    <Card className="py-2 sm:py-6">
      <CardContent className="p-3 sm:p-5">
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-primary/10 p-2 sm:p-2.5">
            <Icon className={`size-4 sm:size-5 ${color ?? "text-primary"}`} />
          </div>
        </div>
        <div className="mt-2 sm:mt-3">
          <p className="text-xl sm:text-3xl font-semibold font-mono tracking-tight">
            {value}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function KnowledgeStatCards({ stats }: { stats: KnowledgeStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6">
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
        icon={UserRound}
        label="My Drafts"
        value={stats.my_drafts}
        color="text-sky-600"
      />
      <StatCard
        icon={Bot}
        label="Agent Live"
        value={stats.agent_ready}
        color="text-emerald-600"
      />
      <StatCard
        icon={ShieldCheck}
        label="Needs Review"
        value={stats.needs_agent_review}
        color="text-amber-600"
      />
    </div>
  )
}
