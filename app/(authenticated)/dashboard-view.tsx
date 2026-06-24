"use client"

import {
  Users,
  Building2,
  CheckSquare,
  TrendingUp,
  TrendingDown,
  Rocket,
  ArrowUpRight,
} from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import { MonthlyPacingChart } from "@/components/dashboard/monthly-pacing-chart"
import type { MonthlyPacingSource } from "@/lib/monthly-pacing"

type TasksByStatus = {
  todo: number
  in_progress: number
  waiting: number
  done: number
}

type RecentTask = {
  id: string
  title: string
  status: string
  tags: string[]
  clientName: string | null
  ownerName: string | null
}

type DashboardStats = {
  totalClients: number
  activeClients: number
  onboardingClients: number
  totalListings: number
  totalTasks: number
  openTasks: number
  tasksByStatus: TasksByStatus
  roadmapInProgress: number
}

const taskBarData = [
  { name: "To Do", value: 0, fill: "hsl(220 9% 46%)" },
  { name: "In Progress", value: 0, fill: "hsl(217 91% 60%)" },
  { name: "Waiting", value: 0, fill: "hsl(38 92% 50%)" },
  { name: "Done", value: 0, fill: "hsl(142 71% 45%)" },
]

const taskBarConfig: ChartConfig = {
  value: { label: "Tasks" },
}

const statusColors: Record<string, string> = {
  todo: "#6b7280",
  in_progress: "#3b82f6",
  waiting: "#f59e0b",
  done: "#22c55e",
}

const statusLabels: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
}

export function DashboardView({
  stats,
  recentTasks,
  monthlyPacingSource,
}: {
  stats: DashboardStats
  recentTasks: RecentTask[]
  monthlyPacingSource: MonthlyPacingSource
}) {
  const barData = taskBarData.map((d, i) => {
    const keys = ["todo", "in_progress", "waiting", "done"] as const
    return { ...d, value: stats.tasksByStatus[keys[i]] }
  })

  const completionRate = stats.totalTasks > 0
    ? Math.round((stats.tasksByStatus.done / stats.totalTasks) * 100)
    : 0

  const avgListingsPerClient = stats.activeClients > 0
    ? Math.round(stats.totalListings / stats.activeClients)
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Portfolio overview and team activity
        </p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Active Clients"
          value={stats.activeClients}
          sub={`${stats.onboardingClients} onboarding`}
          trend={stats.onboardingClients > 0 ? `+${stats.onboardingClients}` : undefined}
          trendUp
          href="/clients"
        />
        <KpiCard
          icon={Building2}
          label="Total Listings"
          value={stats.totalListings}
          sub={`~${avgListingsPerClient} per client`}
          href="/clients"
        />
        <KpiCard
          icon={CheckSquare}
          label="Open Tasks"
          value={stats.openTasks}
          sub={`${stats.totalTasks} total`}
          trend={`${completionRate}% done`}
          trendUp={completionRate >= 50}
          href="/tasks"
        />
        <KpiCard
          icon={Rocket}
          label="Roadmap In Progress"
          value={stats.roadmapInProgress}
          sub="active initiatives"
          href="/roadmap"
        />
      </div>

      {/* Monthly Pacing Chart — full width */}
      <MonthlyPacingChart source={monthlyPacingSource} />

      {/* Bottom Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Task Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Task Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">
              {stats.totalTasks} total tasks
            </p>
          </CardHeader>
          <CardContent>
            <ChartContainer config={taskBarConfig} className="h-[200px] w-full">
              <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                  width={80}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Recent Tasks */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Recent Tasks</CardTitle>
              <p className="text-xs text-muted-foreground">Latest activity across all clients</p>
            </div>
            <Link
              href="/tasks"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            >
              View all <ArrowUpRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentTasks.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>
              )}
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: statusColors[task.status] ?? "#6b7280" }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      {task.clientName && (
                        <p className="text-xs text-muted-foreground truncate">{task.clientName}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 ml-3">
                    {task.ownerName && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">{task.ownerName}</span>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {statusLabels[task.status] ?? task.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Client Status Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ClientStatusCard label="Active" count={stats.activeClients} color="#22c55e" total={stats.totalClients} />
        <ClientStatusCard label="Onboarding" count={stats.onboardingClients} color="#3b82f6" total={stats.totalClients} />
        <ClientStatusCard
          label="Inactive"
          count={stats.totalClients - stats.activeClients - stats.onboardingClients}
          color="#6b7280"
          total={stats.totalClients}
        />
      </div>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  trendUp,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  sub: string
  trend?: string
  trendUp?: boolean
  href?: string
}) {
  const content = (
    <Card className="group relative overflow-hidden transition-colors hover:bg-accent/30">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Icon className="size-5 text-primary" />
          </div>
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${trendUp ? "text-emerald-600" : "text-muted-foreground"}`}>
              {trend}
              {trendUp !== undefined && (
                trendUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />
              )}
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/70">{sub}</p>
      </CardContent>
    </Card>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}

function ClientStatusCard({
  label,
  count,
  color,
  total,
}: {
  label: string
  count: number
  color: string
  total: number
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <span className="text-xs text-muted-foreground">{pct}%</span>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-semibold">{count}</p>
          <p className="text-xs text-muted-foreground">of {total} clients</p>
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
