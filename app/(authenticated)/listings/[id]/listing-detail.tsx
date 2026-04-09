"use client"

import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  Building2,
  MapPin,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Clock,
  RefreshCw,
  Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ListingWithMetrics } from "@/lib/types"

type ClientData = {
  id: string
  name: string
  status: string
} | null

// ─── Mock Data (fallback when PriceLabs not synced) ─────────
// Reservations, reviews, pricing calendar, and pacing
// are NOT available from PriceLabs /listings endpoint.
// They will be replaced when PMS + Airbnb integrations are connected.

const MOCK_MONTHLY_REVENUE = [
  { month: "May 2025", revenue: 7200, nights: 24, adr: 300 },
  { month: "Jun 2025", revenue: 9100, nights: 28, adr: 325 },
  { month: "Jul 2025", revenue: 10500, nights: 30, adr: 350 },
  { month: "Aug 2025", revenue: 9800, nights: 29, adr: 338 },
  { month: "Sep 2025", revenue: 7600, nights: 25, adr: 304 },
  { month: "Oct 2025", revenue: 8200, nights: 27, adr: 304 },
  { month: "Nov 2025", revenue: 6900, nights: 23, adr: 300 },
  { month: "Dec 2025", revenue: 8100, nights: 26, adr: 312 },
  { month: "Jan 2026", revenue: 7400, nights: 24, adr: 308 },
  { month: "Feb 2026", revenue: 7900, nights: 25, adr: 316 },
  { month: "Mar 2026", revenue: 8625, nights: 27, adr: 319 },
  { month: "Apr 2026", revenue: 4200, nights: 14, adr: 300 },
]

const MOCK_UPCOMING_RESERVATIONS = [
  { id: "1", guest: "Sarah M.", checkin: "2026-04-10", checkout: "2026-04-14", nights: 4, total: 1200, source: "Airbnb", status: "confirmed" },
  { id: "2", guest: "James K.", checkin: "2026-04-16", checkout: "2026-04-20", nights: 4, total: 1340, source: "Airbnb", status: "confirmed" },
  { id: "3", guest: "Ana R.", checkin: "2026-04-22", checkout: "2026-04-25", nights: 3, total: 870, source: "Direct", status: "pending" },
  { id: "4", guest: "Michael P.", checkin: "2026-04-28", checkout: "2026-05-03", nights: 5, total: 1650, source: "Airbnb", status: "confirmed" },
  { id: "5", guest: "Laura T.", checkin: "2026-05-05", checkout: "2026-05-09", nights: 4, total: 1280, source: "VRBO", status: "confirmed" },
]

const MOCK_PRICELABS_RATES = [
  { date: "2026-04-07", basePrice: 295, suggestedPrice: 310, minPrice: 250, booked: false },
  { date: "2026-04-08", basePrice: 295, suggestedPrice: 305, minPrice: 250, booked: false },
  { date: "2026-04-09", basePrice: 295, suggestedPrice: 320, minPrice: 250, booked: false },
  { date: "2026-04-10", basePrice: 295, suggestedPrice: 300, minPrice: 250, booked: true },
  { date: "2026-04-11", basePrice: 310, suggestedPrice: 340, minPrice: 260, booked: true },
  { date: "2026-04-12", basePrice: 330, suggestedPrice: 365, minPrice: 280, booked: true },
  { date: "2026-04-13", basePrice: 330, suggestedPrice: 355, minPrice: 280, booked: true },
  { date: "2026-04-14", basePrice: 295, suggestedPrice: 290, minPrice: 250, booked: false },
  { date: "2026-04-15", basePrice: 295, suggestedPrice: 285, minPrice: 250, booked: false },
  { date: "2026-04-16", basePrice: 295, suggestedPrice: 335, minPrice: 250, booked: true },
  { date: "2026-04-17", basePrice: 295, suggestedPrice: 330, minPrice: 250, booked: true },
  { date: "2026-04-18", basePrice: 310, suggestedPrice: 350, minPrice: 260, booked: true },
  { date: "2026-04-19", basePrice: 330, suggestedPrice: 370, minPrice: 280, booked: true },
  { date: "2026-04-20", basePrice: 295, suggestedPrice: 310, minPrice: 250, booked: false },
]

const MOCK_PACING = {
  currentMonth: { booked: 21, available: 30, revenue: 6300, stlyRevenue: 5800 },
  nextMonth: { booked: 18, available: 31, revenue: 5580, stlyRevenue: 6100 },
  monthAfter: { booked: 10, available: 30, revenue: 3200, stlyRevenue: 5400 },
}

// ─── Helper Components ──────────────────────────────────────

function KPIMetric({
  label,
  value,
  badgeColor,
}: {
  label: string
  value: string
  badgeColor?: "green" | "amber" | "red" | "blue"
}) {
  const colorClasses = {
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-4">
      <span className="text-sm font-medium text-muted-foreground text-center leading-tight">
        {label}
      </span>
      {badgeColor ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold font-mono",
            colorClasses[badgeColor]
          )}
        >
          {value}
        </span>
      ) : (
        <span className="text-sm font-bold font-mono">{value}</span>
      )}
    </div>
  )
}

function KPICard({
  title,
  value,
  change,
  icon: Icon,
  prefix,
  suffix,
}: {
  title: string
  value: number | string
  change?: number
  icon: React.ElementType
  prefix?: string
  suffix?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">
          {prefix}
          {typeof value === "number" ? value.toLocaleString() : value}
          {suffix}
        </div>
        {change !== undefined && (
          <p
            className={cn(
              "text-xs flex items-center gap-0.5 mt-1",
              change >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {change >= 0 ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {change >= 0 ? "+" : ""}
            {change}% vs last month
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BarMockup({
  value,
  max,
  color,
}: {
  value: number
  max: number
  color: string
}) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatCurrency(n: number) {
  return `$${n.toLocaleString()}`
}

/**
 * Color based on listing occupancy vs market occupancy:
 * Red:    occ < 0.8 × market
 * Amber:  occ between 0.8 × market and market
 * Green:  occ between market and 1.2 × market
 * Blue:   occ > 1.2 × market
 */
function occColor(occ: number, marketOcc: number | null): "red" | "amber" | "green" | "blue" {
  if (marketOcc == null || marketOcc === 0) return occ > 0 ? "green" : "amber"
  if (occ > 1.2 * marketOcc) return "blue"
  if (occ >= marketOcc) return "green"
  if (occ >= 0.8 * marketOcc) return "amber"
  return "red"
}

// ─── Component ──────────────────────────────────────────────

export function ListingDetail({
  listing,
  client,
}: {
  listing: ListingWithMetrics
  client: ClientData
}) {
  const hasPLData = listing.pl_synced_at != null
  const maxRevenue = Math.max(...MOCK_MONTHLY_REVENUE.map((m) => m.revenue))

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5">
            <Link href="/listings">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {listing.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
              {(listing.city || listing.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {[listing.city, listing.state].filter(Boolean).join(", ")}
                </span>
              )}
              {client && (
                <Link
                  href={`/clients/${client.id}`}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Building2 className="size-3.5" />
                  {client.name}
                </Link>
              )}
              {listing.listing_id && (
                <span className="font-mono text-xs">
                  ID: {listing.listing_id}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {listing.airbnb_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={listing.airbnb_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                Airbnb
              </a>
            </Button>
          )}
          {listing.pricelabs_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={listing.pricelabs_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                PriceLabs
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ─── Sync Status Banner ─────────────────────────── */}
      {hasPLData ? (
        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <RefreshCw className="size-3.5" />
            <span>
              PriceLabs data synced{" "}
              {new Date(listing.pl_synced_at!).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {listing.pl_push_enabled && (
              <Badge variant="outline" className="text-[10px] ml-1 border-green-300 text-green-700 dark:text-green-400">
                Push ON
              </Badge>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>Preview:</strong> PriceLabs data has not been synced yet.
            Reservations, reviews, and pricing calendar show mockup data and will
            use real data once PMS and Airbnb integrations are connected.
          </p>
        </div>
      )}

      {/* ─── PriceLabs KPI Row ─────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="grid grid-cols-10 min-w-[900px] divide-x">
              <KPIMetric
                label="Base Price"
                value={listing.pl_base_price != null ? `$${listing.pl_base_price}` : "—"}
              />
              <KPIMetric
                label="Min Price"
                value={listing.pl_min_price != null ? `$${listing.pl_min_price}` : "—"}
              />
              <KPIMetric
                label="Occ (7N)"
                value={listing.pl_occupancy_next_7 != null ? `${listing.pl_occupancy_next_7}%` : "—"}
                badgeColor={listing.pl_occupancy_next_7 != null ? occColor(listing.pl_occupancy_next_7, listing.pl_market_occupancy_next_7) : undefined}
              />
              <KPIMetric
                label="Mkt Occ (7N)"
                value={listing.pl_market_occupancy_next_7 != null ? `${listing.pl_market_occupancy_next_7}%` : "—"}
              />
              <KPIMetric
                label="Occ (30N)"
                value={listing.pl_occupancy_next_30 != null ? `${listing.pl_occupancy_next_30}%` : "—"}
                badgeColor={listing.pl_occupancy_next_30 != null ? occColor(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30) : undefined}
              />
              <KPIMetric
                label="Mkt Occ (30N)"
                value={listing.pl_market_occupancy_next_30 != null ? `${listing.pl_market_occupancy_next_30}%` : "—"}
              />
              <KPIMetric
                label="Wknd Occ (30N)"
                value={listing.pl_wknd_occupancy_next_30 != null ? `${listing.pl_wknd_occupancy_next_30}%` : "—"}
                badgeColor={listing.pl_wknd_occupancy_next_30 != null ? occColor(listing.pl_wknd_occupancy_next_30, listing.pl_market_wknd_occupancy_next_30) : undefined}
              />
              <KPIMetric
                label="Mkt Wknd (30N)"
                value={listing.pl_market_wknd_occupancy_next_30 != null ? `${listing.pl_market_wknd_occupancy_next_30}%` : "—"}
              />
              <KPIMetric
                label="MPI (30N)"
                value={listing.pl_mpi_next_30 != null ? String(listing.pl_mpi_next_30) : "—"}
                badgeColor={listing.pl_mpi_next_30 != null ? (listing.pl_mpi_next_30 >= 1.2 ? "blue" : listing.pl_mpi_next_30 >= 1 ? "green" : listing.pl_mpi_next_30 >= 0.8 ? "amber" : "red") : undefined}
              />
              <KPIMetric
                label="Last Booked"
                value={listing.pl_last_booked_date ? new Date(listing.pl_last_booked_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Secondary KPI Cards ─────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Base Price"
          value={listing.pl_base_price ?? "—"}
          icon={DollarSign}
          prefix={listing.pl_base_price != null ? "$" : ""}
        />
        <KPICard
          title="Recommended Price"
          value={listing.pl_recommended_base_price ?? "—"}
          icon={BarChart3}
          prefix={listing.pl_recommended_base_price != null ? "$" : ""}
        />
        <KPICard
          title="MPI (60N)"
          value={listing.pl_mpi_next_60 ?? "—"}
          icon={Activity}
        />
        <KPICard
          title="Occ 90N"
          value={listing.pl_occupancy_past_90 ?? "—"}
          icon={TrendingUp}
          suffix={listing.pl_occupancy_past_90 != null ? "%" : ""}
        />
      </div>

      {/* ─── Tabs ────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reservations">Reservations</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="pacing">Pacing</TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab ────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Monthly Revenue Chart (mock — needs PMS data) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Monthly Revenue</CardTitle>
                <CardDescription>
                  Last 12 months revenue performance
                  {!hasPLData && " (mockup data)"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {MOCK_MONTHLY_REVENUE.map((m) => (
                    <div
                      key={m.month}
                      className="grid grid-cols-[100px_1fr_80px] items-center gap-3"
                    >
                      <span className="text-xs text-muted-foreground truncate">
                        {m.month}
                      </span>
                      <BarMockup
                        value={m.revenue}
                        max={maxRevenue}
                        color="bg-primary"
                      />
                      <span className="text-xs font-mono text-right">
                        ${m.revenue.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* PriceLabs stats sidebar */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Market Comparison</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Your Occ (30N)
                    </span>
                    <span className="font-medium font-mono">
                      {listing.pl_occupancy_next_30 != null
                        ? `${listing.pl_occupancy_next_30}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Market Occ (30N)
                    </span>
                    <span className="font-medium font-mono">
                      {listing.pl_market_occupancy_next_30 != null
                        ? `${listing.pl_market_occupancy_next_30}%`
                        : "—"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Wknd Occ (30N)
                    </span>
                    <span className="font-medium font-mono">
                      {listing.pl_wknd_occupancy_next_30 != null
                        ? `${listing.pl_wknd_occupancy_next_30}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Mkt Wknd (30N)
                    </span>
                    <span className="font-medium font-mono">
                      {listing.pl_market_wknd_occupancy_next_30 != null
                        ? `${listing.pl_market_wknd_occupancy_next_30}%`
                        : "—"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      MPI (30N)
                    </span>
                    <span
                      className={cn(
                        "font-bold font-mono",
                        listing.pl_mpi_next_30 != null && listing.pl_mpi_next_30 >= 1
                          ? "text-green-600 dark:text-green-400"
                          : listing.pl_mpi_next_30 != null
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      )}
                    >
                      {listing.pl_mpi_next_30 ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      MPI (60N)
                    </span>
                    <span
                      className={cn(
                        "font-bold font-mono",
                        listing.pl_mpi_next_60 != null && listing.pl_mpi_next_60 >= 1
                          ? "text-green-600 dark:text-green-400"
                          : listing.pl_mpi_next_60 != null
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      )}
                    >
                      {listing.pl_mpi_next_60 ?? "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Listing Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {listing.pl_no_of_bedrooms != null && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Bedrooms
                        </span>
                        <span className="font-medium font-mono">
                          {listing.pl_no_of_bedrooms}
                        </span>
                      </div>
                      <Separator />
                    </>
                  )}
                  {listing.pl_cleaning_fees != null && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Cleaning Fee
                        </span>
                        <span className="font-medium font-mono">
                          ${listing.pl_cleaning_fees}
                        </span>
                      </div>
                      <Separator />
                    </>
                  )}
                  {listing.pl_last_booked_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Last Booked
                      </span>
                      <span className="font-medium font-mono">
                        {new Date(listing.pl_last_booked_date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Occ 90N
                    </span>
                    <span className="font-medium font-mono">
                      {listing.pl_occupancy_past_90 != null
                        ? `${listing.pl_occupancy_past_90}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Mkt Occ 90N
                    </span>
                    <span className="font-medium font-mono text-muted-foreground">
                      {listing.pl_market_occupancy_past_90 != null
                        ? `${listing.pl_market_occupancy_past_90}%`
                        : "—"}
                    </span>
                  </div>
                  {listing.pl_last_refreshed_at && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="size-3.5" />
                          PL Refreshed
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(listing.pl_last_refreshed_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── Reservations Tab (mock — needs PMS) ─────────── */}
        <TabsContent value="reservations" className="space-y-4">
          {!hasPLData && (
            <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Reservation data requires PMS integration (coming soon).
              </p>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Upcoming Reservations
              </CardTitle>
              <CardDescription>
                Next 30 days of confirmed and pending bookings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Guest</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead className="text-center">Nights</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MOCK_UPCOMING_RESERVATIONS.map((res) => (
                      <TableRow key={res.id}>
                        <TableCell className="font-medium">
                          {res.guest}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(res.checkin)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(res.checkout)}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">
                          {res.nights}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(res.total)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {res.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] capitalize",
                              res.status === "confirmed"
                                ? "bg-green-500/10 text-green-700 border-green-300 dark:text-green-400"
                                : "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400"
                            )}
                          >
                            {res.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  This Month
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">8 bookings</div>
                <p className="text-xs text-muted-foreground mt-1">
                  27 nights booked
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Nightly Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">$319</div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  +6% vs last month
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Cancellation Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">3.2%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  1 cancellation in 31 bookings
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Pricing Tab (mock — needs PriceLabs rates API) ── */}
        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                PriceLabs Rate Calendar
              </CardTitle>
              <CardDescription>
                Base price vs suggested price for the next 14 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">Suggested</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Diff</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MOCK_PRICELABS_RATES.map((r) => {
                      const diff = r.suggestedPrice - r.basePrice
                      const diffPct = ((diff / r.basePrice) * 100).toFixed(1)
                      const d = new Date(r.date + "T00:00:00")
                      const dayName = d.toLocaleDateString("en-US", {
                        weekday: "short",
                      })
                      const isWeekend = d.getDay() === 0 || d.getDay() === 5 || d.getDay() === 6
                      return (
                        <TableRow
                          key={r.date}
                          className={cn(
                            r.booked && "bg-primary/5",
                            isWeekend && !r.booked && "bg-muted/30"
                          )}
                        >
                          <TableCell className="text-sm">
                            {formatDate(r.date)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {dayName}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ${r.basePrice}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium">
                            ${r.suggestedPrice}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            ${r.minPrice}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono text-sm",
                              diff > 0
                                ? "text-green-600 dark:text-green-400"
                                : diff < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-muted-foreground"
                            )}
                          >
                            {diff > 0 ? "+" : ""}
                            {diffPct}%
                          </TableCell>
                          <TableCell className="text-center">
                            {r.booked ? (
                              <Badge className="text-[10px] bg-primary">
                                Booked
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-muted-foreground"
                              >
                                Open
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Price Range
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">
                  {listing.pl_min_price != null && listing.pl_max_price != null
                    ? `$${listing.pl_min_price} – $${listing.pl_max_price}`
                    : "$250 – $370"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {hasPLData ? "PriceLabs min/max range" : "Based on PriceLabs dynamic pricing"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Base vs Recommended
                </CardTitle>
              </CardHeader>
              <CardContent>
                {listing.pl_base_price != null && listing.pl_recommended_base_price != null ? (
                  <>
                    <div
                      className={cn(
                        "text-xl font-bold font-mono",
                        listing.pl_recommended_base_price >= listing.pl_base_price
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {listing.pl_recommended_base_price >= listing.pl_base_price ? "+" : ""}
                      {(
                        ((listing.pl_recommended_base_price - listing.pl_base_price) /
                          listing.pl_base_price) *
                        100
                      ).toFixed(1)}
                      %
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      ${listing.pl_base_price} → ${listing.pl_recommended_base_price} recommended
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-bold font-mono text-green-600 dark:text-green-400">
                      +7.2%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      PriceLabs recommends higher rates
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Push Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">
                  {listing.pl_push_enabled != null
                    ? listing.pl_push_enabled
                      ? "Enabled"
                      : "Disabled"
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  PriceLabs price push to PMS
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Pacing Tab (mock — needs PMS data) ──────────── */}
        <TabsContent value="pacing" className="space-y-4">
          {!hasPLData && (
            <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Pacing data requires PMS integration (coming soon). Showing mockup data.
              </p>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { label: "This Month (Apr)", data: MOCK_PACING.currentMonth },
              { label: "Next Month (May)", data: MOCK_PACING.nextMonth },
              { label: "Jun 2026", data: MOCK_PACING.monthAfter },
            ].map(({ label, data }) => {
              const occPct = Math.round((data.booked / data.available) * 100)
              const revenueVsStly = data.stlyRevenue
                ? (
                    ((data.revenue - data.stlyRevenue) / data.stlyRevenue) *
                    100
                  ).toFixed(1)
                : null
              const isAhead = data.revenue >= data.stlyRevenue

              return (
                <Card key={label}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-muted-foreground">Occupancy</span>
                        <span className="font-mono font-medium">
                          {data.booked}/{data.available} nights ({occPct}%)
                        </span>
                      </div>
                      <BarMockup
                        value={data.booked}
                        max={data.available}
                        color={
                          occPct >= 80
                            ? "bg-green-500"
                            : occPct >= 50
                              ? "bg-amber-500"
                              : "bg-red-400"
                        }
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Revenue</span>
                        <span className="font-mono font-medium">
                          {formatCurrency(data.revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">STLY</span>
                        <span className="font-mono text-muted-foreground">
                          {formatCurrency(data.stlyRevenue)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">vs STLY</span>
                        <span
                          className={cn(
                            "font-mono font-medium flex items-center gap-1",
                            isAhead
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          )}
                        >
                          {isAhead ? (
                            <TrendingUp className="size-3" />
                          ) : (
                            <TrendingDown className="size-3" />
                          )}
                          {revenueVsStly && Number(revenueVsStly) > 0 ? "+" : ""}
                          {revenueVsStly}%
                        </span>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Implied ADR</span>
                      <span className="font-mono font-medium">
                        {formatCurrency(Math.round(data.revenue / data.booked))}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                90-Day Pacing Summary
              </CardTitle>
              <CardDescription>
                Booking pace compared to same time last year
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total Booked Revenue
                  </p>
                  <p className="text-lg font-bold font-mono mt-1">$15,080</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">STLY Revenue</p>
                  <p className="text-lg font-bold font-mono mt-1">$17,300</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gap to Close</p>
                  <p className="text-lg font-bold font-mono mt-1 text-red-600 dark:text-red-400">
                    -$2,220
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Nights to Sell</p>
                  <p className="text-lg font-bold font-mono mt-1">42 nights</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
