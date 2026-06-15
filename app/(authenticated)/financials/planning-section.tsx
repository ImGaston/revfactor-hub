"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  buildForecast,
  calculateRunwayMonths,
  type ForecastMonth,
  type ScenarioEventKind,
} from "@/lib/financial-planning"
import type {
  FinancialScenario,
  FinancialScenarioEvent,
  FinancialScenarioEventAllocation,
  FinancialScenarioListing,
} from "@/lib/types"
import {
  cloneFinancialScenario,
  createFinancialScenario,
  deleteFinancialScenario,
  deleteScenarioEvent,
  deleteScenarioListing,
  getPlanningData,
  saveScenarioEvent,
  saveScenarioListing,
  updateFinancialScenario,
} from "./actions"

type PlanningData = {
  scenarios: FinancialScenario[]
  listings: FinancialScenarioListing[]
  events: FinancialScenarioEvent[]
  eventAllocations: FinancialScenarioEventAllocation[]
  openingCashCents: number
}

type DeleteTarget =
  | { type: "scenario"; id: string; label: string }
  | { type: "listing"; id: string; label: string }
  | { type: "event"; id: string; label: string }

const chartColors = ["var(--chart-2)", "var(--chart-4)", "var(--chart-5)"]

function currency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function PlanningSection() {
  const [data, setData] = useState<PlanningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState("")
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [scenarioDialogOpen, setScenarioDialogOpen] = useState(false)
  const [editingScenario, setEditingScenario] =
    useState<FinancialScenario | null>(null)
  const [listingDialogOpen, setListingDialogOpen] = useState(false)
  const [editingListing, setEditingListing] =
    useState<FinancialScenarioListing | null>(null)
  const [eventDialogOpen, setEventDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] =
    useState<FinancialScenarioEvent | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const reload = useCallback(async (preferredId?: string) => {
    setLoading(true)
    const result = await getPlanningData()
    setLoading(false)
    if (result.error || !result.data) {
      toast.error(result.error ?? "Unable to load planning data")
      return
    }
    const nextData = result.data as PlanningData
    setData(nextData)
    setSelectedId((current) => {
      const candidate = preferredId ?? current
      return nextData.scenarios.some((scenario) => scenario.id === candidate)
        ? candidate
        : (nextData.scenarios[0]?.id ?? "")
    })
    setCompareIds((current) =>
      current.filter((id) =>
        nextData.scenarios.some((scenario) => scenario.id === id)
      )
    )
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  const selectedScenario =
    data?.scenarios.find((scenario) => scenario.id === selectedId) ?? null
  const selectedListings =
    data?.listings.filter((listing) => listing.scenario_id === selectedId) ?? []
  const selectedEvents =
    data?.events.filter((event) => event.scenario_id === selectedId) ?? []

  const forecasts = useMemo(() => {
    if (!data) return new Map<string, ForecastMonth[]>()
    return new Map(
      data.scenarios.map((scenario) => [
        scenario.id,
        buildForecast({
          startMonth: scenario.start_month.slice(0, 7),
          horizonMonths: scenario.horizon_months,
          openingCashCents: data.openingCashCents,
          listings: data.listings
            .filter((listing) => listing.scenario_id === scenario.id)
            .map((listing) => ({
              id: listing.id,
              name: listing.name,
              monthlyRevenueCents: Number(listing.monthly_revenue_cents),
              startMonth: listing.start_month.slice(0, 7),
              endMonth: listing.end_month?.slice(0, 7) ?? null,
            })),
          events: data.events
            .filter((event) => event.scenario_id === scenario.id)
            .map((event) => ({
              id: event.id,
              kind: event.kind,
              description: event.description,
              amountCents: Number(event.amount_cents),
              recurrence: event.recurrence,
              startMonth: event.start_month.slice(0, 7),
              endMonth: event.end_month?.slice(0, 7) ?? null,
            })),
        }),
      ])
    )
  }, [data])

  const selectedForecast = forecasts.get(selectedId) ?? []
  const displayedCompareIds =
    compareIds.length > 0 ? compareIds : selectedId ? [selectedId] : []
  const comparisonRows = Array.from({ length: 12 }, (_, index) => {
    const row: Record<string, string | number> = {
      month:
        displayedCompareIds.length > 0
          ? (forecasts.get(displayedCompareIds[0])?.[index]?.month ?? "")
          : "",
    }
    for (const id of displayedCompareIds) {
      row[id] = forecasts.get(id)?.[index]?.endingCashCents
        ? Number(forecasts.get(id)?.[index]?.endingCashCents) / 100
        : 0
    }
    return row
  })
  const comparisonConfig = Object.fromEntries(
    displayedCompareIds.map((id, index) => [
      id,
      {
        label:
          data?.scenarios.find((scenario) => scenario.id === id)?.name ??
          "Scenario",
        color: chartColors[index],
      },
    ])
  ) satisfies ChartConfig

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  }

  if (!data) return null

  async function handleDelete() {
    if (!deleteTarget) return
    const result =
      deleteTarget.type === "scenario"
        ? await deleteFinancialScenario(deleteTarget.id)
        : deleteTarget.type === "listing"
          ? await deleteScenarioListing(deleteTarget.id)
          : await deleteScenarioEvent(deleteTarget.id)
    if (result.error) toast.error(result.error)
    else {
      toast.success(`${deleteTarget.type} deleted`)
      await reload()
    }
    setDeleteTarget(null)
  }

  async function handleClone() {
    if (!selectedScenario) return
    const result = await cloneFinancialScenario(
      selectedScenario.id,
      `${selectedScenario.name} Copy`
    )
    if (result.error) toast.error(result.error)
    else {
      toast.success("Scenario cloned")
      await reload(result.id ?? undefined)
    }
  }

  const endingCash =
    selectedForecast.at(-1)?.endingCashCents ?? data.openingCashCents
  const runway = calculateRunwayMonths(selectedForecast)
  const annualRevenue = selectedForecast.reduce(
    (sum, month) => sum + month.revenueCents,
    0
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a scenario" />
          </SelectTrigger>
          <SelectContent>
            {data.scenarios.map((scenario) => (
              <SelectItem key={scenario.id} value={scenario.id}>
                {scenario.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => {
            setEditingScenario(null)
            setScenarioDialogOpen(true)
          }}
        >
          <Plus />
          New scenario
        </Button>
        {selectedScenario && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditingScenario(selectedScenario)
                setScenarioDialogOpen(true)
              }}
            >
              <Pencil />
              Rename
            </Button>
            <Button variant="outline" onClick={handleClone}>
              <Copy />
              Clone
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteTarget({
                  type: "scenario",
                  id: selectedScenario.id,
                  label: selectedScenario.name,
                })
              }
            >
              <Trash2 />
              Delete
            </Button>
          </>
        )}
      </div>

      {data.scenarios.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Build your first scenario</CardTitle>
            <CardDescription>
              Start from active listings, Stripe subscription amounts, recurring
              expenses, and the latest cash balance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setEditingScenario(null)
                setScenarioDialogOpen(true)
              }}
            >
              <Plus />
              Create baseline
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              label="12-month payout forecast"
              value={currency(annualRevenue)}
            />
            <SummaryCard
              label="Ending operating cash"
              value={currency(endingCash)}
            />
            <SummaryCard
              label="Runway"
              value={runway === null ? "12+ months" : `${runway} months`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Scenario comparison</CardTitle>
              <CardDescription>
                Select up to three scenarios. Capital contributions affect cash
                but not Profit First allocations.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                {data.scenarios.map((scenario) => {
                  const checked = displayedCompareIds.includes(scenario.id)
                  return (
                    <label
                      key={scenario.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setCompareIds((current) => {
                            const base =
                              current.length === 0 ? [selectedId] : current
                            if (next) {
                              if (
                                base.includes(scenario.id) ||
                                base.length >= 3
                              )
                                return base
                              return [...base, scenario.id]
                            }
                            return base.filter((id) => id !== scenario.id)
                          })
                        }}
                      />
                      {scenario.name}
                    </label>
                  )
                })}
              </div>
              <ChartContainer
                config={comparisonConfig}
                className="h-[300px] w-full"
              >
                <LineChart data={comparisonRows}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <div className="flex min-w-36 items-center justify-between gap-3">
                            <span>{comparisonConfig[String(name)]?.label}</span>
                            <span className="font-mono font-medium">
                              {currency(Number(value) * 100)}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  {displayedCompareIds.map((id, index) => (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={id}
                      stroke={chartColors[index]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Listings</CardTitle>
                <CardDescription>
                  Monthly payout expected for each listing
                </CardDescription>
                <CardAction>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingListing(null)
                      setListingDialogOpen(true)
                    }}
                  >
                    <Plus />
                    Add listing
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">
                        Monthly payout
                      </TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedListings.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell className="font-medium">
                          {listing.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {currency(Number(listing.monthly_revenue_cents))}
                        </TableCell>
                        <TableCell>{listing.start_month.slice(0, 7)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingListing(listing)
                                setListingDialogOpen(true)
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setDeleteTarget({
                                  type: "listing",
                                  id: listing.id,
                                  label: listing.name,
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Expenses and investments</CardTitle>
                <CardDescription>
                  Operating costs, growth spend, and capital events
                </CardDescription>
                <CardAction>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingEvent(null)
                      setEventDialogOpen(true)
                    }}
                  >
                    <Plus />
                    Add event
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <p className="font-medium">{event.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {event.recurrence === "monthly"
                              ? "Monthly"
                              : "One time"}{" "}
                            from {event.start_month.slice(0, 7)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {eventLabel(event.kind)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {currency(Number(event.amount_cents))}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingEvent(event)
                                setEventDialogOpen(true)
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setDeleteTarget({
                                  type: "event",
                                  id: event.id,
                                  label: event.description,
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Monthly plan</CardTitle>
              <CardDescription>
                Cash view, not an accrual accounting statement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Payouts</TableHead>
                    <TableHead className="text-right">
                      OPEX allocation
                    </TableHead>
                    <TableHead className="text-right">
                      Expenses + investment
                    </TableHead>
                    <TableHead className="text-right">Capital</TableHead>
                    <TableHead className="text-right">Ending cash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedForecast.map((month) => (
                    <TableRow key={month.month}>
                      <TableCell>{month.month}</TableCell>
                      <TableCell className="text-right font-mono">
                        {currency(month.revenueCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currency(month.opexAllocatedCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currency(
                          month.fixedExpensesCents +
                            month.variableExpensesCents +
                            month.growthInvestmentCents
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currency(month.capitalContributionCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currency(month.endingCashCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <ScenarioDialog
        key={`${editingScenario?.id ?? "new"}-${scenarioDialogOpen}`}
        open={scenarioDialogOpen}
        onOpenChange={setScenarioDialogOpen}
        scenario={editingScenario}
        onSaved={reload}
      />
      {selectedScenario && (
        <>
          <ListingDialog
            key={`${editingListing?.id ?? "new"}-${listingDialogOpen}`}
            open={listingDialogOpen}
            onOpenChange={setListingDialogOpen}
            scenario={selectedScenario}
            listing={editingListing}
            onSaved={reload}
          />
          <EventDialog
            key={`${editingEvent?.id ?? "new"}-${eventDialogOpen}`}
            open={eventDialogOpen}
            onOpenChange={setEventDialogOpen}
            scenario={selectedScenario}
            event={editingEvent}
            listings={selectedListings}
            allocations={data.eventAllocations}
            onSaved={reload}
          />
        </>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action permanently removes the selected planning data. Actual
              financial data is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function ScenarioDialog({
  open,
  onOpenChange,
  scenario,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: FinancialScenario | null
  onSaved: (preferredId?: string) => Promise<void>
}) {
  const [name, setName] = useState(scenario?.name ?? "Base")
  const [description, setDescription] = useState(scenario?.description ?? "")
  const [startMonth, setStartMonth] = useState(
    scenario?.start_month.slice(0, 7) ?? currentMonth()
  )
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = scenario
      ? await updateFinancialScenario({
          id: scenario.id,
          name,
          description,
        })
      : await createFinancialScenario({ name, description, startMonth })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(scenario ? "Scenario updated" : "Scenario created")
    onOpenChange(false)
    const preferredId = scenario
      ? scenario.id
      : "id" in result && typeof result.id === "string"
        ? result.id
        : undefined
    await onSaved(preferredId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {scenario ? "Rename scenario" : "Create scenario"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scenario-name">Name</Label>
            <Input
              id="scenario-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scenario-description">Description</Label>
            <Textarea
              id="scenario-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {!scenario && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scenario-start">Start month</Label>
              <Input
                id="scenario-start"
                type="month"
                value={startMonth}
                onChange={(event) => setStartMonth(event.target.value)}
                required
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ListingDialog({
  open,
  onOpenChange,
  scenario,
  listing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: FinancialScenario
  listing: FinancialScenarioListing | null
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(listing?.name ?? "")
  const [amount, setAmount] = useState(
    String(Number(listing?.monthly_revenue_cents ?? 0) / 100)
  )
  const [startMonth, setStartMonth] = useState(
    listing?.start_month.slice(0, 7) ?? scenario.start_month.slice(0, 7)
  )
  const [endMonth, setEndMonth] = useState(
    listing?.end_month?.slice(0, 7) ?? ""
  )
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await saveScenarioListing({
      id: listing?.id,
      scenarioId: scenario.id,
      name,
      monthlyRevenueCents: Math.round(Number(amount) * 100),
      startMonth,
      endMonth: endMonth || null,
    })
    setSaving(false)
    if (result.error) toast.error(result.error)
    else {
      toast.success("Listing saved")
      onOpenChange(false)
      await onSaved()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{listing ? "Edit listing" : "Add listing"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-listing-name">Name</Label>
            <Input
              id="plan-listing-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-listing-amount">Monthly payout ($)</Label>
            <Input
              id="plan-listing-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-listing-start">Start month</Label>
              <Input
                id="plan-listing-start"
                type="month"
                value={startMonth}
                onChange={(event) => setStartMonth(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-listing-end">End month</Label>
              <Input
                id="plan-listing-end"
                type="month"
                value={endMonth}
                onChange={(event) => setEndMonth(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EventDialog({
  open,
  onOpenChange,
  scenario,
  event,
  listings,
  allocations: allAllocations,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: FinancialScenario
  event: FinancialScenarioEvent | null
  listings: FinancialScenarioListing[]
  allocations: FinancialScenarioEventAllocation[]
  onSaved: () => Promise<void>
}) {
  const [description, setDescription] = useState(event?.description ?? "")
  const [kind, setKind] = useState<ScenarioEventKind>(
    event?.kind ?? "fixed_expense"
  )
  const [amount, setAmount] = useState(
    String(Number(event?.amount_cents ?? 0) / 100)
  )
  const [recurrence, setRecurrence] = useState<"one_time" | "monthly">(
    event?.recurrence ?? "monthly"
  )
  const [startMonth, setStartMonth] = useState(
    event?.start_month.slice(0, 7) ?? scenario.start_month.slice(0, 7)
  )
  const [endMonth, setEndMonth] = useState(event?.end_month?.slice(0, 7) ?? "")
  const [listingToAdd, setListingToAdd] = useState("")
  const [allocations, setAllocations] = useState<
    { scenarioListingId: string; amountCents: number }[]
  >(
    event
      ? allAllocations
          .filter((allocation) => allocation.event_id === event.id)
          .map((allocation) => ({
            scenarioListingId: allocation.scenario_listing_id,
            amountCents: Number(allocation.amount_cents),
          }))
      : []
  )
  const [saving, setSaving] = useState(false)

  async function handleSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    const amountCents = Math.round(Number(amount) * 100)
    if (
      kind === "variable_expense" &&
      allocations.length > 0 &&
      allocations.reduce(
        (sum, allocation) => sum + allocation.amountCents,
        0
      ) !== amountCents
    ) {
      toast.error("Listing allocations must equal the event total")
      return
    }
    setSaving(true)
    const result = await saveScenarioEvent({
      id: event?.id,
      scenarioId: scenario.id,
      kind,
      description,
      amountCents,
      recurrence,
      startMonth,
      endMonth: endMonth || null,
      allocations,
    })
    setSaving(false)
    if (result.error) toast.error(result.error)
    else {
      toast.success("Planning event saved")
      onOpenChange(false)
      await onSaved()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-description">Description</Label>
            <Input
              id="event-description"
              value={description}
              onChange={(changeEvent) =>
                setDescription(changeEvent.target.value)
              }
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as ScenarioEventKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_expense">Fixed expense</SelectItem>
                  <SelectItem value="variable_expense">
                    Variable expense
                  </SelectItem>
                  <SelectItem value="growth_investment">
                    Growth investment
                  </SelectItem>
                  <SelectItem value="capital_contribution">
                    Capital contribution
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-amount">Amount ($)</Label>
              <Input
                id="event-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(changeEvent) => setAmount(changeEvent.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Frequency</Label>
              <Select
                value={recurrence}
                onValueChange={(value) =>
                  setRecurrence(value as "one_time" | "monthly")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">One time</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-start">Start</Label>
              <Input
                id="event-start"
                type="month"
                value={startMonth}
                onChange={(changeEvent) =>
                  setStartMonth(changeEvent.target.value)
                }
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-end">End</Label>
              <Input
                id="event-end"
                type="month"
                value={endMonth}
                onChange={(changeEvent) =>
                  setEndMonth(changeEvent.target.value)
                }
                disabled={recurrence === "one_time"}
              />
            </div>
          </div>

          {kind === "variable_expense" && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <Label>Optional listing split</Label>
              <div className="flex gap-2">
                <Select value={listingToAdd} onValueChange={setListingToAdd}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose listing" />
                  </SelectTrigger>
                  <SelectContent>
                    {listings
                      .filter(
                        (listing) =>
                          !allocations.some(
                            (allocation) =>
                              allocation.scenarioListingId === listing.id
                          )
                      )
                      .map((listing) => (
                        <SelectItem key={listing.id} value={listing.id}>
                          {listing.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!listingToAdd) return
                    setAllocations((current) => [
                      ...current,
                      { scenarioListingId: listingToAdd, amountCents: 0 },
                    ])
                    setListingToAdd("")
                  }}
                >
                  Add
                </Button>
              </div>
              {allocations.map((allocation) => (
                <div
                  key={allocation.scenarioListingId}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 text-sm">
                    {listings.find(
                      (listing) => listing.id === allocation.scenarioListingId
                    )?.name ?? "Listing"}
                  </span>
                  <Input
                    className="w-32"
                    type="number"
                    min="0"
                    step="0.01"
                    value={allocation.amountCents / 100}
                    onChange={(changeEvent) =>
                      setAllocations((current) =>
                        current.map((item) =>
                          item.scenarioListingId ===
                          allocation.scenarioListingId
                            ? {
                                ...item,
                                amountCents: Math.round(
                                  Number(changeEvent.target.value || 0) * 100
                                ),
                              }
                            : item
                        )
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setAllocations((current) =>
                        current.filter(
                          (item) =>
                            item.scenarioListingId !==
                            allocation.scenarioListingId
                        )
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function eventLabel(kind: FinancialScenarioEvent["kind"]): string {
  return {
    fixed_expense: "Fixed",
    variable_expense: "Variable",
    growth_investment: "Growth",
    capital_contribution: "Capital",
  }[kind]
}
