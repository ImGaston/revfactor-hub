"use client"

import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  Building2,
  MapPin,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BedDouble,
  BarChart3,
  Star,
  Percent,
  Activity,
  Clock,
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
import { Skeleton } from "@/components/ui/skeleton"
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

type ListingData = {
  id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  client_id: string
  created_at: string
  updated_at: string
}

type ClientData = {
  id: string
  name: string
  status: string
} | null

// ─── Mock Data ──────────────────────────────────────────────
// These will be replaced with real data from PriceLabs API, reservations DB, etc.

const MOCK_KPI = {
  adr: 287.5,
  adrChange: 12.3,
  occupancy: 78.4,
  occupancyChange: -2.1,
  revpar: 225.4,
  revparChange: 8.7,
  revenue_mtd: 8625,
  revenueChange: 15.2,
  avg_rating: 4.87,
  total_reviews: 142,
  avg_lead_time: 18,
}

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
  {
    id: "1",
    guest: "Sarah M.",
    checkin: "2026-04-10",
    checkout: "2026-04-14",
    nights: 4,
    total: 1200,
    source: "Airbnb",
    status: "confirmed",
  },
  {
    id: "2",
    guest: "James K.",
    checkin: "2026-04-16",
    checkout: "2026-04-20",
    nights: 4,
    total: 1340,
    source: "Airbnb",
    status: "confirmed",
  },
  {
    id: "3",
    guest: "Ana R.",
    checkin: "2026-04-22",
    checkout: "2026-04-25",
    nights: 3,
    total: 870,
    source: "Direct",
    status: "pending",
  },
  {
    id: "4",
    guest: "Michael P.",
    checkin: "2026-04-28",
    checkout: "2026-05-03",
    nights: 5,
    total: 1650,
    source: "Airbnb",
    status: "confirmed",
  },
  {
    id: "5",
    guest: "Laura T.",
    checkin: "2026-05-05",
    checkout: "2026-05-09",
    nights: 4,
    total: 1280,
    source: "VRBO",
    status: "confirmed",
  },
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

// ─── Component ──────────────────────────────────────────────

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

export function ListingDetail({
  listing,
  client,
}: {
  listing: ListingData
  client: ClientData
}) {
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

      {/* ─── Mockup Notice ───────────────────────────────── */}
      <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          <strong>Preview:</strong> This dashboard shows mockup data. Real data
          will be sourced from PriceLabs API, PMS reservations, and Airbnb
          reviews once integrations are connected.
        </p>
      </div>

      {/* ─── KPI Cards ───────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="ADR"
          value={MOCK_KPI.adr}
          change={MOCK_KPI.adrChange}
          icon={DollarSign}
          prefix="$"
        />
        <KPICard
          title="Occupancy"
          value={MOCK_KPI.occupancy}
          change={MOCK_KPI.occupancyChange}
          icon={Percent}
          suffix="%"
        />
        <KPICard
          title="RevPAR"
          value={MOCK_KPI.revpar}
          change={MOCK_KPI.revparChange}
          icon={BarChart3}
          prefix="$"
        />
        <KPICard
          title="Revenue MTD"
          value={MOCK_KPI.revenue_mtd}
          change={MOCK_KPI.revenueChange}
          icon={TrendingUp}
          prefix="$"
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
            {/* Monthly Revenue Chart (bar mockup) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Monthly Revenue</CardTitle>
                <CardDescription>
                  Last 12 months revenue performance
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

            {/* Quick stats sidebar */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Guest Reviews</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Star className="size-4 text-amber-500 fill-amber-500" />
                      Average Rating
                    </span>
                    <span className="text-lg font-bold font-mono">
                      {MOCK_KPI.avg_rating}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Reviews
                    </span>
                    <span className="font-medium font-mono">
                      {MOCK_KPI.total_reviews}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span>5 stars</span>
                      <span className="text-muted-foreground">82%</span>
                    </div>
                    <BarMockup value={82} max={100} color="bg-green-500" />
                    <div className="flex justify-between text-xs">
                      <span>4 stars</span>
                      <span className="text-muted-foreground">12%</span>
                    </div>
                    <BarMockup value={12} max={100} color="bg-emerald-400" />
                    <div className="flex justify-between text-xs">
                      <span>3 stars</span>
                      <span className="text-muted-foreground">4%</span>
                    </div>
                    <BarMockup value={4} max={100} color="bg-yellow-400" />
                    <div className="flex justify-between text-xs">
                      <span>1-2 stars</span>
                      <span className="text-muted-foreground">2%</span>
                    </div>
                    <BarMockup value={2} max={100} color="bg-red-400" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Booking Insights</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="size-4" />
                      Avg Lead Time
                    </span>
                    <span className="font-medium font-mono">
                      {MOCK_KPI.avg_lead_time} days
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Avg Stay Length
                    </span>
                    <span className="font-medium font-mono">3.8 nights</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Repeat Guests
                    </span>
                    <span className="font-medium font-mono">14%</span>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      Booking Sources
                    </span>
                    <div className="flex gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        Airbnb 72%
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        Direct 18%
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        VRBO 10%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── Reservations Tab ────────────────────────────── */}
        <TabsContent value="reservations" className="space-y-4">
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

          {/* Reservation Stats Cards */}
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

        {/* ─── Pricing Tab ─────────────────────────────────── */}
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

          {/* Pricing Insight Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Price Range (Next 30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">$250 – $370</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on PriceLabs dynamic pricing
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Suggested vs Base
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono text-green-600 dark:text-green-400">
                  +7.2%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  PriceLabs recommends higher rates
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Weekday vs Weekend Gap
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold font-mono">+18%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Weekend rates premium over weekdays
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Pacing Tab ──────────────────────────────────── */}
        <TabsContent value="pacing" className="space-y-4">
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
                    {/* Occupancy */}
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

                    {/* Revenue vs STLY */}
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
                        <span className="text-muted-foreground">
                          vs STLY
                        </span>
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

                    {/* ADR comparison */}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Implied ADR
                      </span>
                      <span className="font-mono font-medium">
                        {formatCurrency(
                          Math.round(data.revenue / data.booked)
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Pacing summary card */}
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
                  <p className="text-sm text-muted-foreground">
                    STLY Revenue
                  </p>
                  <p className="text-lg font-bold font-mono mt-1">$17,300</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Gap to Close
                  </p>
                  <p className="text-lg font-bold font-mono mt-1 text-red-600 dark:text-red-400">
                    -$2,220
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Nights to Sell
                  </p>
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
