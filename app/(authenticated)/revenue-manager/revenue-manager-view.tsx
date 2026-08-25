"use client"

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Database,
  FileCheck2,
  Gauge,
  Info,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { RevenueManagerWorkspace } from "@/lib/revenue-manager/workspace"

function formatPercent(value: number | null | undefined) {
  if (value == null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function valueFrom(
  section: Record<string, { value: unknown }>,
  key: string
): unknown {
  return section[key]?.value ?? null
}

function IndicatorCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          <span className="text-xs font-medium tracking-wide uppercase">
            {label}
          </span>
        </div>
        <CardTitle className="mt-1 text-2xl">{value}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function TodayView({ workspace }: { workspace: RevenueManagerWorkspace }) {
  const pace = workspace.metrics.find(
    (metric) => metric.metricKey === "adjusted_occupancy_15d"
  )
  const exposure = workspace.metrics.find(
    (metric) => metric.metricKey === "minimum_price_exposure_15d"
  )
  const attention = workspace.review.attention

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              >
                Evidence blocked
              </Badge>
              <span className="text-xs text-muted-foreground">
                Review state:{" "}
                {workspace.review.primaryState.replaceAll("_", " ")}
              </span>
            </div>
            <CardTitle className="mt-3 text-xl leading-snug md:text-2xl">
              {workspace.review.verdict}
            </CardTitle>
          </CardHeader>
          {attention && (
            <CardContent className="grid gap-5">
              <div>
                <p className="font-heading text-base font-medium">
                  {attention.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {attention.summary}
                </p>
              </div>
              <div className="rounded-2xl bg-muted/60 p-4">
                <div className="flex items-start gap-3">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Next safe step
                    </p>
                    <p className="mt-1 leading-relaxed">{attention.nextStep}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled>
                  <LockKeyhole />
                  Resolve evidence first
                </Button>
                <span className="text-xs text-muted-foreground">
                  No pricing or availability change is proposed.
                </span>
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Why this is the attention item</CardTitle>
            <CardDescription>
              Facts, interpretation, and action boundaries stay separate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 font-medium">
                <Database className="size-4 text-emerald-600" />
                Fact
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The supplied 15-day snapshot shows {formatPercent(pace?.value)}{" "}
                adjusted occupancy versus{" "}
                {formatPercent(pace?.benchmark?.value)} for the stated market
                benchmark, with {formatPercent(exposure?.value)} of the window
                reported at minimum price.
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 font-medium">
                <Gauge className="size-4 text-amber-600" />
                Inference
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Demand may be stronger than the floor, close-in discount, and
                date-override stack is capturing. Alternative explanations
                remain open.
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-sky-600" />
                Boundary
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Validate metric and inventory semantics before drafting any
                commercial change. Base price is not the assumed answer.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <IndicatorCard
          icon={TrendingUp}
          label="15-day pace"
          value={`${formatPercent(pace?.value)} vs ${formatPercent(pace?.benchmark?.value)}`}
          detail="Property versus stated market benchmark"
        />
        <IndicatorCard
          icon={CircleDollarSign}
          label="At minimum"
          value={formatPercent(exposure?.value)}
          detail="Reported minimum-price exposure, next 15 days"
        />
        <IndicatorCard
          icon={AlertTriangle}
          label="Data confidence"
          value="Medium"
          detail={`${workspace.review.dataIssues.length} blocking definitions to resolve`}
        />
      </div>
    </div>
  )
}

function ProfileView({ workspace }: { workspace: RevenueManagerWorkspace }) {
  const profile = workspace.profile
  const goal = valueFrom(profile.objective, "annualRevenueGoal") as number
  const basePrice = valueFrom(profile.pricingStrategy, "basePrice") as number
  const minimumPrice = valueFrom(
    profile.pricingStrategy,
    "minimumPrice"
  ) as number
  const airbnbMarkup = valueFrom(profile.distribution, "airbnbMarkup") as number
  const directPolicy = valueFrom(
    profile.distribution,
    "directGuestPricePolicy"
  ) as number

  const sections = [
    {
      title: "Objective",
      icon: CircleDollarSign,
      rows: [
        ["Annual gross revenue goal", formatMoney(goal)],
        ["Revenue definition", "Unresolved"],
        ["Target period", "Unresolved"],
        ["Priority", "Revenue growth and improved ADR"],
      ],
    },
    {
      title: "Pricing strategy",
      icon: TrendingUp,
      rows: [
        ["Current base price", formatMoney(basePrice)],
        ["Minimum price", formatMoney(minimumPrice)],
        ["Last-minute rule", "Up to 25% inside 20 days"],
        ["Base-price recommendation", "Not yet justified"],
      ],
    },
    {
      title: "Distribution",
      icon: Gauge,
      rows: [
        ["Airbnb markup", `${airbnbMarkup}% — intentional`],
        ["Direct booking", `${directPolicy}% below Airbnb final guest price`],
        ["Comparison basis", "All-in final guest price"],
      ],
    },
    {
      title: "Operating constraints",
      icon: ShieldCheck,
      rows: [
        ["Protected dates", "July 4 and December 31"],
        ["Same-day turns", "Allowed"],
        ["Permit inventory", "Temporary blocks recorded"],
        ["Personal use", "None identified"],
      ],
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map(({ title, icon: Icon, rows }) => (
        <Card key={title}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              <CardTitle>{title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {rows.map(([label, value], index) => (
              <div key={label}>
                {index > 0 && <Separator className="mb-3" />}
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right font-medium">{value}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Alert className="md:col-span-2">
        <Info />
        <AlertTitle>Profile needs confirmation</AlertTitle>
        <AlertDescription>
          The $95,000 goal cannot be scored until its revenue measure and target
          period are defined. Historical costs are reference-only and cannot
          support a current profit claim.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function DecisionsView() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Decision ledger</CardTitle>
          <CardDescription>
            Recommendations and human decisions will remain append-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center">
            <FileCheck2 className="size-9 text-muted-foreground" />
            <p className="mt-4 font-medium">No decision requested</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              This review is blocked by evidence definitions, so RevFactor has
              not manufactured a pricing recommendation or approval request.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Governed lifecycle</CardTitle>
          <CardDescription>
            What happens after evidence is ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {[
            ["1", "Structured recommendation", "Frozen facts and guardrails"],
            ["2", "Human decision", "Approve, decline, change, or defer"],
            ["3", "Controlled Adjustment", "Manual execution in V1"],
            ["4", "Verification", "Observed state must match intent"],
            ["5", "Outcome review", "Expected versus actual result"],
          ].map(([step, title, detail], index) => (
            <div key={step}>
              {index > 0 && <Separator className="mb-4" />}
              <div className="flex gap-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {step}
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{detail}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function EvidenceView({ workspace }: { workspace: RevenueManagerWorkspace }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Metric evidence</CardTitle>
          <CardDescription>
            Every metric carries its scope, definition, source, as-of time, and
            freshness.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead>
              <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                <th className="pb-3 font-medium">Metric</th>
                <th className="pb-3 font-medium">Value</th>
                <th className="pb-3 font-medium">Stay range</th>
                <th className="pb-3 font-medium">Definition</th>
                <th className="pb-3 font-medium">Source</th>
                <th className="pb-3 text-right font-medium">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {workspace.metrics.map((metric) => (
                <tr key={metric.evidenceId} className="border-b last:border-0">
                  <td className="py-4 pr-4 font-medium">
                    {metric.metricKey.replaceAll("_", " ")}
                  </td>
                  <td className="py-4 pr-4">
                    {metric.unit === "ratio"
                      ? formatPercent(metric.value)
                      : String(metric.value ?? "—")}
                    {metric.benchmark?.value != null && (
                      <span className="block text-xs text-muted-foreground">
                        Benchmark {formatPercent(metric.benchmark.value)}
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4 whitespace-nowrap">
                    {metric.stayRange.start} → {metric.stayRange.end}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs">
                    {metric.definitionVersion}
                  </td>
                  <td className="py-4 pr-4">
                    <span className="block">{metric.sourceType}</span>
                    <span className="block max-w-48 truncate text-xs text-muted-foreground">
                      {metric.sourceSnapshotId}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <Badge
                      variant={
                        metric.freshness === "current" ? "secondary" : "outline"
                      }
                    >
                      {metric.freshness}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocking data issues</CardTitle>
          <CardDescription>
            Only the decisions materially affected by an issue are blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {workspace.review.dataIssues.map((issue) => (
            <div
              key={issue.issueKey}
              className="flex items-start gap-3 rounded-2xl border p-4"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{issue.title}</p>
                  <Badge variant="outline">{issue.severity}</Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {issue.detail}
                </p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {issue.issueKey}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export function RevenueManagerView({
  workspace,
}: {
  workspace: RevenueManagerWorkspace
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Revenue Manager
            </h1>
            <Badge variant="secondary">Read-only pilot</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {workspace.property.name} · {workspace.property.market} ·{" "}
            {workspace.property.lifecycleLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          Evidence as of {formatDateTime(workspace.asOf)}
        </div>
      </div>

      <Alert className="border-sky-500/20 bg-sky-500/5">
        <Info />
        <AlertTitle>Sanitized Ashwood fixture preview</AlertTitle>
        <AlertDescription>
          This workspace is computed locally from versioned test evidence.
          Migration 075 is not applied, no database row is created, and no
          PriceLabs, PMS, or OTA write is available.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="today">
        <div className="overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="today" className="mt-4">
          <TodayView workspace={workspace} />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <ProfileView workspace={workspace} />
        </TabsContent>
        <TabsContent value="decisions" className="mt-4">
          <DecisionsView />
        </TabsContent>
        <TabsContent value="evidence" className="mt-4">
          <EvidenceView workspace={workspace} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5" />
          Contract-validated read model · {workspace.sourceCount} frozen source
          snapshots
        </span>
        <span className="flex items-center gap-1.5">
          <LockKeyhole className="size-3.5" />
          No external side effects
        </span>
      </div>
    </div>
  )
}
