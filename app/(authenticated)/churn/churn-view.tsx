"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  Building2,
  CalendarClock,
  SlidersHorizontal,
  Tag,
  UserMinus,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ClientChurnTable,
  ReasonChips,
} from "@/components/churn/client-churn-table"
import { CLIENT_CHURN_REASONS, churnReasonLabel } from "@/lib/clients"
import {
  EMPTY_CHURN_FILTERS,
  filterChurnClients,
  filterLeavingClients,
  filterListingExits,
  formatChurnDate,
  summarizeChurn,
  validDate,
  type ChurnClient,
  type ChurnFilters,
  type LeavingClient,
  type ListingExit,
} from "@/lib/churn"
import { TagListingExitDialog } from "./tag-listing-exit-dialog"

type Props = {
  clients: ChurnClient[]
  exits: ListingExit[]
  leaving: LeavingClient[]
  asOf: string
  isSuperAdmin: boolean
  canTagExits: boolean
  canEditClients: boolean
}
export function ChurnView({
  clients,
  exits,
  leaving,
  asOf,
  isSuperAdmin,
  canTagExits,
  canEditClients,
}: Props) {
  const [filters, setFilters] = useState<ChurnFilters>(EMPTY_CHURN_FILTERS)
  const [tab, setTab] = useState("clients")
  const [tagging, setTagging] = useState<ListingExit | null>(null)
  const markets = useMemo(
    () =>
      [
        ...new Set(
          [...clients, ...exits, ...leaving].flatMap((row) => row.markets)
        ),
      ].sort(),
    [clients, exits, leaving]
  )
  const invalidRange = !!(
    (filters.from && !validDate(filters.from)) ||
    (filters.to && !validDate(filters.to)) ||
    (filters.from && filters.to && filters.from > filters.to)
  )
  const filteredClients = useMemo(
    () => (invalidRange ? [] : filterChurnClients(clients, filters)),
    [clients, filters, invalidRange]
  )
  const filteredExits = useMemo(
    () => (invalidRange ? [] : filterListingExits(exits, filters)),
    [exits, filters, invalidRange]
  )
  const filteredLeaving = useMemo(
    () => (invalidRange ? [] : filterLeavingClients(leaving, filters)),
    [leaving, filters, invalidRange]
  )
  const summary = useMemo(
    () => summarizeChurn(filteredClients, filteredExits, asOf),
    [filteredClients, filteredExits, asOf]
  )
  const hasFilters =
    filters.reason !== "all" ||
    filters.market !== "all" ||
    !!filters.from ||
    !!filters.to
  function setFilter<K extends keyof ChurnFilters>(
    key: K,
    value: ChurnFilters[K]
  ) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Churn tracker
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Client offboarding, scheduled cancellations, and listing exits.
          </p>
        </div>
        {canEditClients && (
          <Button asChild variant="outline">
            <Link href="/settings/clients">
              <SlidersHorizontal data-icon="inline-start" />
              Manage client offboarding
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Client churns · last 12 months</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <UserMinus className="size-5 text-muted-foreground" />
              {summary.clientCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopReasons items={summary.clientReasons} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Listing exits · last 12 months</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              {summary.listingCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopReasons items={summary.listingReasons} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Average months as client</CardDescription>
            <CardTitle>{summary.avgTenure ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Among {summary.tenureCount} filtered churned clients with valid
              start and end dates.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly churn</CardTitle>
          <CardDescription>
            12 calendar months through {formatChurnDate(asOf)} · follows the
            reason, market, and date filters. Listing exits count partial exits
            only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                {summary.months.map((row) => (
                  <TableHead key={row.month} className="text-center">
                    {new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString(
                      "en-US",
                      { timeZone: "UTC", month: "short", year: "2-digit" }
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Clients</TableCell>
                {summary.months.map((row) => (
                  <TableCell
                    key={row.month}
                    className="text-center tabular-nums"
                  >
                    {row.clients}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>Listing exits</TableCell>
                {summary.months.map((row) => (
                  <TableCell
                    key={row.month}
                    className="text-center tabular-nums"
                  >
                    {row.listings}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Client churn uses ending date; listing exits use deactivation date.
            Leaving soon uses the scheduled subscription end date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field>
              <FieldLabel htmlFor="churn-reason">Reason</FieldLabel>
              <Select
                value={filters.reason}
                onValueChange={(value) => setFilter("reason", value)}
                disabled={tab === "leaving"}
              >
                <SelectTrigger id="churn-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All reasons</SelectItem>
                    <SelectItem value="untagged">Untagged</SelectItem>
                    {CLIENT_CHURN_REASONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="churn-market">Market</FieldLabel>
              <Select
                value={filters.market}
                onValueChange={(value) => setFilter("market", value)}
              >
                <SelectTrigger id="churn-market">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All markets</SelectItem>
                    {markets.map((market) => (
                      <SelectItem key={market} value={market}>
                        {market}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={invalidRange}>
              <FieldLabel htmlFor="churn-from">From</FieldLabel>
              <Input
                id="churn-from"
                type="date"
                value={filters.from}
                onChange={(event) => setFilter("from", event.target.value)}
                aria-invalid={invalidRange}
              />
            </Field>
            <Field data-invalid={invalidRange}>
              <FieldLabel htmlFor="churn-to">Through</FieldLabel>
              <Input
                id="churn-to"
                type="date"
                value={filters.to}
                onChange={(event) => setFilter("to", event.target.value)}
                aria-invalid={invalidRange}
              />
            </Field>
            <Field className="justify-end">
              <Button
                variant="outline"
                onClick={() => setFilters(EMPTY_CHURN_FILTERS)}
                disabled={!hasFilters}
              >
                Clear filters
              </Button>
            </Field>
          </FieldGroup>
          {invalidRange && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              Choose a valid date range with the start on or before the end.
            </p>
          )}
        </CardContent>
      </Card>

      {(summary.undatedClients > 0 || summary.undatedListings > 0) && (
        <Alert>
          <AlertDescription>
            {summary.undatedClients} client churns and {summary.undatedListings}{" "}
            listing exits have no end date. They appear in the unfiltered tables
            but are excluded from monthly totals and date-range results.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="clients">
              <UserMinus />
              Client churn{" "}
              <Badge variant="secondary">{filteredClients.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="leaving">
              <CalendarClock />
              Leaving soon{" "}
              <Badge variant="secondary">{filteredLeaving.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="listings">
              <Building2 />
              Listing exits{" "}
              <Badge variant="secondary">{filteredExits.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="clients">
          <Card>
            <CardHeader>
              <CardTitle>Client churn</CardTitle>
              <CardDescription>
                Inactive clients only. Edit status, ending date, reasons, and
                note in Settings → Clients. Market is derived from the client’s
                listing cities and states.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ClientChurnTable
                clients={filteredClients}
                showMarkets
                showBilling={isSuperAdmin}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="leaving">
          <Card>
            <CardHeader>
              <CardTitle>Leaving soon</CardTitle>
              <CardDescription>
                Active clients with a subscription scheduled to cancel at period
                end, from the daily Stripe mirror. Cancellation may cover part
                of an account; the client remains active until offboarded.
                Reason filters do not apply.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!filteredLeaving.length ? (
                <TrackerEmpty
                  title="No scheduled cancellations"
                  description="No active clients have a scheduled subscription cancellation matching these filters."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Market</TableHead>
                      <TableHead>Scheduled end</TableHead>
                      <TableHead>Subscriptions</TableHead>
                      <TableHead>Mirror refreshed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeaving.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell className="whitespace-normal">
                          <Link
                            href={`/clients/${client.id}`}
                            className="font-medium hover:underline"
                          >
                            {client.name}
                          </Link>
                          <div className="mt-1">
                            <Badge variant="outline">Active client</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {client.markets.join(" · ") || "Unknown market"}
                        </TableCell>
                        <TableCell>
                          {[
                            ...new Set(
                              client.cancellations.map((item) =>
                                formatChurnDate(item.scheduled_end)
                              )
                            ),
                          ].join(" · ")}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {client.cancellations.length} scheduled to cancel
                        </TableCell>
                        <TableCell>
                          {formatChurnDate(
                            [
                              ...client.cancellations.map(
                                (item) => item.synced_at
                              ),
                            ]
                              .sort()[0]
                              ?.slice(0, 10) ?? null
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="listings">
          <Card>
            <CardHeader>
              <CardTitle>Listing exits</CardTitle>
              <CardDescription>
                Inactive listings belonging to active clients. Tagging an exit
                keeps the parent client active. Set listing status and
                deactivation date in Settings → Listings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!filteredExits.length ? (
                <TrackerEmpty
                  title="No listing exits"
                  description="No partial exits match these filters. Only listings whose parent account is still active appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Listing / client</TableHead>
                      <TableHead>Market</TableHead>
                      <TableHead>Deactivated</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Handled by</TableHead>
                      <TableHead>Stripe item</TableHead>
                      {canTagExits && (
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExits.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell className="max-w-64 whitespace-normal">
                          <Link
                            href={`/listings/${listing.id}`}
                            className="font-medium hover:underline"
                          >
                            {listing.name}
                          </Link>
                          <div className="mt-1 text-sm text-muted-foreground">
                            <Link
                              href={`/clients/${listing.client_id}`}
                              className="hover:underline"
                            >
                              {listing.client_name}
                            </Link>{" "}
                            · active
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {listing.markets.join(" · ")}
                        </TableCell>
                        <TableCell>
                          {formatChurnDate(listing.deactivated_date)}
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal">
                          <ReasonChips
                            reasons={
                              listing.exit_reason ? [listing.exit_reason] : []
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-72 wrap-anywhere whitespace-normal">
                          {listing.exit_note || "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {listing.exit_handled_by || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              listing.stripe_item_status === "pending"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {listing.stripe_item_status === "n/a"
                              ? "Not applicable"
                              : listing.stripe_item_status === "adjusted"
                                ? "Adjusted"
                                : "Pending"}
                          </Badge>
                        </TableCell>
                        {canTagExits && (
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setTagging(listing)}
                              aria-label={`Tag exit for ${listing.name}`}
                            >
                              <Tag data-icon="inline-start" />
                              Tag exit
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {tagging && (
        <TagListingExitDialog
          key={tagging.id}
          listing={tagging}
          onClose={() => setTagging(null)}
        />
      )}
    </div>
  )
}
function TopReasons({ items }: { items: { reason: string; count: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.length ? (
        items.map((item) => (
          <Badge key={item.reason} variant="secondary">
            {churnReasonLabel(item.reason)} · {item.count}
          </Badge>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No tagged exits in this period.
        </p>
      )}
    </div>
  )
}
function TrackerEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
