"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ExternalLink,
  Mail,
  Calendar,
  CreditCard,
  Building2,
  CheckSquare,
  ArrowLeft,
  Link2,
  Unlink,
  MessageSquare,
  Users,
  Loader2,
  MapPin,
  ArrowUpDown,
  Plus,
  Pencil,
  Copy,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { StripeSubscriptionPriceOption } from "@/lib/stripe"
import type { Client, ClientCredential, Listing } from "@/lib/types"
import { resolveProfile } from "@/lib/types"
import { ClientCredentials } from "./client-credentials"
import { AddListingDialog } from "./add-listing-dialog"
import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"
import { ClientDialog } from "@/app/(authenticated)/settings/clients/client-dialog"

/**
 * Color based on listing occupancy vs market occupancy:
 * Red:    occ < 0.8 × market
 * Amber:  occ between 0.8 × market and market
 * Green:  occ between market and 1.2 × market
 * Blue:   occ > 1.2 × market
 */
function occColor(occ: number, marketOcc: number | null): "green" | "amber" | "red" | "blue" {
  if (marketOcc == null || marketOcc === 0) return occ > 0 ? "green" : "amber"
  if (occ > 1.2 * marketOcc) return "blue"
  if (occ >= marketOcc) return "green"
  if (occ >= 0.8 * marketOcc) return "amber"
  return "red"
}

type SortOption = "name" | "occ7n" | "occ30n" | "mpi30n" | "last_booked"

function sortListings(listings: Listing[], sort: SortOption, dir: "asc" | "desc"): Listing[] {
  const sorted = [...listings].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name)
      case "occ7n":
        return (a.pl_occupancy_next_7 ?? -1) - (b.pl_occupancy_next_7 ?? -1)
      case "occ30n":
        return (a.pl_occupancy_next_30 ?? -1) - (b.pl_occupancy_next_30 ?? -1)
      case "mpi30n":
        return (a.pl_mpi_next_30 ?? -1) - (b.pl_mpi_next_30 ?? -1)
      case "last_booked": {
        const da = a.pl_last_booked_date ? new Date(a.pl_last_booked_date).getTime() : 0
        const db = b.pl_last_booked_date ? new Date(b.pl_last_booked_date).getTime() : 0
        return da - db
      }
      default:
        return 0
    }
  })
  return dir === "desc" ? sorted.reverse() : sorted
}

function ListingKPI({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: "green" | "amber" | "red" | "blue"
}) {
  const colorClass =
    color === "blue"
      ? "text-blue-600 dark:text-blue-400"
      : color === "green"
        ? "text-green-600 dark:text-green-400"
        : color === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : color === "red"
            ? "text-red-600 dark:text-red-400"
            : "text-foreground"
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-base font-bold font-mono flex items-center gap-1 ${colorClass}`}>
        {value}
      </span>
    </div>
  )
}

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  onboarding: "secondary",
  inactive: "outline",
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-muted-foreground">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function formatDate(date: string | null) {
  if (!date) return "—"
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function stripeCustomerDashboardUrl(customerId: string) {
  return `https://dashboard.stripe.com/customers/${customerId}`
}

function formatPriceOption(option: StripeSubscriptionPriceOption) {
  const amount =
    option.amount == null
      ? "Variable"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: option.currency.toUpperCase(),
        }).format(option.amount)
  const interval =
    option.intervalCount > 1
      ? `every ${option.intervalCount} ${option.interval}s`
      : `/${option.interval}`
  return `${amount} ${interval}`
}

export function ClientDetailPage({
  client,
  credentials = [],
  isSuperAdmin,
  assemblyConfigured,
  stripeConfigured,
  stripeCustomerIds = [],
  onLinkAssembly,
  onUnlinkAssembly,
  onLoadStripeOptions,
  onCreateStripeCheckout,
}: {
  client: Client
  credentials?: ClientCredential[]
  isSuperAdmin: boolean
  assemblyConfigured: boolean
  stripeConfigured: boolean
  stripeCustomerIds?: string[]
  onLinkAssembly?: (clientId: string) => Promise<{ error: string | null }>
  onUnlinkAssembly?: (clientId: string) => Promise<{ error: string | null }>
  onLoadStripeOptions?: () => Promise<{
    error: string | null
    options: StripeSubscriptionPriceOption[]
  }>
  onCreateStripeCheckout?: (input: {
    clientId: string
    priceId: string
    includeOnboardingFee?: boolean
    onboardingFeeAmount?: number
  }) => Promise<{
    error: string | null
    checkoutUrl: string | null
    checkoutSessionId?: string
    stripeCustomerId?: string
    stripeDashboardUrl?: string
  }>
}) {
  const [linking, setLinking] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [addListingOpen, setAddListingOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [stripeDialogOpen, setStripeDialogOpen] = useState(false)
  const [stripeOptions, setStripeOptions] = useState<StripeSubscriptionPriceOption[]>([])
  const [stripeOptionsLoaded, setStripeOptionsLoaded] = useState(false)
  const [loadingStripeOptions, setLoadingStripeOptions] = useState(false)
  const [selectedPriceId, setSelectedPriceId] = useState("")
  const [creatingCheckout, setCreatingCheckout] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [localStripeCustomerIds, setLocalStripeCustomerIds] = useState(stripeCustomerIds)
  const [includeOnboardingFee, setIncludeOnboardingFee] = useState(stripeCustomerIds.length === 0)
  const [onboardingFeeAmount, setOnboardingFeeAmount] = useState("125")
  const [stripeDashboardUrl, setStripeDashboardUrl] = useState<string | null>(
    client.stripe_dashboard ?? (stripeCustomerIds[0] ? stripeCustomerDashboardUrl(stripeCustomerIds[0]) : null)
  )

  const sortedListings = useMemo(
    () => sortListings(client.listings, sortBy, sortDir),
    [client.listings, sortBy, sortDir]
  )
  const isLinked = !!client.assembly_client_id
  const hasStripeCustomer = localStripeCustomerIds.length > 0
  const selectedOption = stripeOptions.find((option) => option.priceId === selectedPriceId) ?? null

  const loadStripeOptions = useCallback(async () => {
    if (!stripeConfigured || !onLoadStripeOptions || stripeOptionsLoaded || loadingStripeOptions) return
    setLoadingStripeOptions(true)
    const result = await onLoadStripeOptions()
    setLoadingStripeOptions(false)
    if (result.error) {
      toast.error(result.error)
      setStripeOptionsLoaded(true)
      return
    }
    setStripeOptions(result.options)
    setSelectedPriceId((current) => current || result.options[0]?.priceId || "")
    setStripeOptionsLoaded(true)
  }, [loadingStripeOptions, onLoadStripeOptions, stripeConfigured, stripeOptionsLoaded])

  async function handleLink() {
    if (!onLinkAssembly) return
    setLinking(true)
    const result = await onLinkAssembly(client.id)
    setLinking(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Linked to Assembly")
    }
  }

  async function handleCopyEmbed() {
    if (!client.dashboard_token) {
      toast.error("This client has no dashboard token yet")
      return
    }
    const url = `https://assembly-pricelabs.vercel.app/api/dashboard/${client.id}?token=${client.dashboard_token}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        throw new Error("Clipboard API unavailable")
      }
      toast.success("Embed link copied")
    } catch {
      const ta = document.createElement("textarea")
      ta.value = url
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      if (ok) {
        toast.success("Embed link copied")
      } else {
        toast.error("Could not copy. Link: " + url, { duration: 10000 })
      }
    }
  }

  async function handleCopyCheckout() {
    if (!checkoutUrl) return
    try {
      await navigator.clipboard.writeText(checkoutUrl)
      toast.success("Checkout link copied")
    } catch {
      toast.error("Could not copy checkout link")
    }
  }

  async function handleStripeDialogOpenChange(open: boolean) {
    setStripeDialogOpen(open)
    if (open) {
      await loadStripeOptions()
    }
  }

  async function handleCreateStripeCheckout() {
    if (!onCreateStripeCheckout || !selectedPriceId) return
    const parsedOnboardingFee = Number(onboardingFeeAmount)
    if (includeOnboardingFee && (!Number.isFinite(parsedOnboardingFee) || parsedOnboardingFee < 0)) {
      toast.error("Enter a valid onboarding fee")
      return
    }
    setCreatingCheckout(true)
    const result = await onCreateStripeCheckout({
      clientId: client.id,
      priceId: selectedPriceId,
      includeOnboardingFee,
      onboardingFeeAmount: parsedOnboardingFee,
    })
    setCreatingCheckout(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    setCheckoutUrl(result.checkoutUrl)
    if (result.stripeDashboardUrl) {
      setStripeDashboardUrl(result.stripeDashboardUrl)
    } else if (result.stripeCustomerId) {
      setStripeDashboardUrl(stripeCustomerDashboardUrl(result.stripeCustomerId))
    }
    if (result.stripeCustomerId) {
      setLocalStripeCustomerIds((current) =>
        current.includes(result.stripeCustomerId!) ? current : [...current, result.stripeCustomerId!]
      )
    }
    toast.success(hasStripeCustomer ? "Checkout link created" : "Stripe customer and checkout link created")
  }

  async function handleUnlink() {
    if (!onUnlinkAssembly) return
    setLinking(true)
    const result = await onUnlinkAssembly(client.id)
    setLinking(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Unlinked from Assembly")
    }
  }

  return (
    <div className="space-y-6">
      <BreadcrumbSetter segment={client.id} label={client.name} />
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/clients">
            <ArrowLeft className="mr-1 size-4" />
            Back to clients
          </Link>
        </Button>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.name}
          </h1>
          <Badge
            variant={statusVariant[client.status] ?? "outline"}
          >
            {client.status}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            Edit
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {client.email && (
          <InfoRow icon={Mail} label="Email">
            <span>{client.email}</span>
          </InfoRow>
        )}

        {isSuperAdmin && (
          <InfoRow icon={CreditCard} label="Billing">
            <span className="font-mono">
              {client.billing_amount
                ? `$${Number(client.billing_amount).toLocaleString()}/mo`
                : "—"}
            </span>
            {client.autopayment_set_up && (
              <Badge variant="secondary" className="ml-2">
                Autopay
              </Badge>
            )}
          </InfoRow>
        )}

        <InfoRow icon={Calendar} label="Contract">
          <span>
            {formatDate(client.onboarding_date)} — {formatDate(client.ending_date)}
          </span>
        </InfoRow>

        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && stripeDashboardUrl && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={stripeDashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {isSuperAdmin && (
            <Button
              variant={hasStripeCustomer ? "outline" : "default"}
              size="sm"
              onClick={() => handleStripeDialogOpenChange(true)}
              disabled={!stripeConfigured}
              title={
                stripeConfigured
                  ? hasStripeCustomer
                    ? "Create a subscription checkout link for this client"
                    : "Create a Stripe customer and subscription checkout link"
                  : "Stripe is not configured"
              }
            >
              <CreditCard className="mr-1 size-3" />
              {hasStripeCustomer ? "New Stripe Checkout" : "Create Stripe customer"}
            </Button>
          )}
          {isLinked && client.assembly_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={client.assembly_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {client.assembly_company_id ? (
                  <Users className="mr-1 size-3" />
                ) : (
                  <MessageSquare className="mr-1 size-3" />
                )}
                {client.assembly_company_id ? "Company Chat" : "Messages"}
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {isLinked && client.assembly_company_id && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://dashboard.assembly.com/clients/users/details/${client.assembly_client_id}/messages`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageSquare className="mr-1 size-3" />
                Direct Chat
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {assemblyConfigured && !isLinked && client.email && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLink}
              disabled={linking}
            >
              {linking ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Link2 className="mr-1 size-3" />
              )}
              Link to Assembly
            </Button>
          )}
          {isLinked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnlink}
              disabled={linking}
              className="text-muted-foreground"
            >
              <Unlink className="mr-1 size-3" />
              Unlink
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyEmbed}
            disabled={!client.dashboard_token}
            title={
              client.dashboard_token
                ? "Copy dashboard embed link for Assembly portal"
                : "No dashboard token set for this client"
            }
          >
            <Copy className="mr-1 size-3" />
            Copy embed link
          </Button>
        </div>
      </div>

      {client.tasks.filter((t) => t.status !== "done").length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <CheckSquare className="size-4" />
              Open Tasks
              <span className="text-muted-foreground">
                ({client.tasks.filter((t) => t.status !== "done").length})
              </span>
            </h3>
            <div className="mt-3 space-y-1.5">
              {client.tasks
                .filter((t) => t.status !== "done")
                .map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            task.status === "in_progress"
                              ? "#3b82f6"
                              : task.status === "waiting"
                                ? "#f59e0b"
                                : "#6b7280",
                        }}
                      />
                      <span className="truncate">{task.title}</span>
                    </div>
                    <div className="flex shrink-0 gap-1.5 ml-2">
                      {task.owner && (() => {
                        const p = resolveProfile(task.profiles)
                        return (
                          <Badge variant="outline" className="text-[10px]">
                            {p?.full_name || p?.email || task.owner}
                          </Badge>
                        )
                      })()}
                      {task.tags?.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      <Separator />

      <ClientCredentials clientId={client.id} credentials={credentials} />

      <Separator />

      <div>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="size-4" />
            Listings
            <span className="text-muted-foreground">
              ({client.listings.length})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {client.listings.length > 1 && (
              <>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <ArrowUpDown className="mr-1 size-3" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="occ7n">Occ (7N)</SelectItem>
                    <SelectItem value="occ30n">Occ (30N)</SelectItem>
                    <SelectItem value="mpi30n">MPI (30N)</SelectItem>
                    <SelectItem value="last_booked">Last Booked</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={sortDir === "asc" ? "Ascending" : "Descending"}
                >
                  <span className="text-xs font-mono">{sortDir === "asc" ? "↑" : "↓"}</span>
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setAddListingOpen(true)}
              title="Add listing"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sortedListings.map((listing) => {
            const location = [listing.city, listing.state].filter(Boolean).join(", ")
            return (
              <Link
                key={listing.id}
                href={`/listings/${listing.id}`}
                className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 hover:shadow-sm"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold leading-tight">
                      {listing.name}
                    </p>
                    {location && (
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" />
                        <span>{location}</span>
                        {listing.airbnb_link && listing.airbnb_link !== "https://www.airbnb.com/rooms/" && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(listing.airbnb_link!, "_blank")
                            }}
                            className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer ml-0.5"
                            title="Airbnb"
                          >
                            <img src="/airbnb-logo.webp" alt="Airbnb" className="size-4 rounded" />
                          </span>
                        )}
                        {listing.pricelabs_link && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(listing.pricelabs_link!, "_blank")
                            }}
                            className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                            title="PriceLabs"
                          >
                            <img src="/Pricelabs-Logo.webp" alt="PriceLabs" className="size-4 rounded" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="my-3 border-t" />

                {/* KPIs */}
                <div className="grid grid-cols-4 gap-x-6">
                  <ListingKPI
                    label="Occ (7N)"
                    value={listing.pl_occupancy_next_7 != null ? `${listing.pl_occupancy_next_7}%` : "—"}
                    color={listing.pl_occupancy_next_7 != null ? occColor(listing.pl_occupancy_next_7, listing.pl_market_occupancy_next_7) : undefined}
                  />
                  <ListingKPI
                    label="Occ (30N)"
                    value={listing.pl_occupancy_next_30 != null ? `${listing.pl_occupancy_next_30}%` : "—"}
                    color={listing.pl_occupancy_next_30 != null ? occColor(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30) : undefined}
                  />
                  <ListingKPI
                    label="MPI (30N)"
                    value={listing.pl_mpi_next_30 != null ? String(listing.pl_mpi_next_30) : "—"}
                    color={listing.pl_mpi_next_30 != null ? (listing.pl_mpi_next_30 >= 1.2 ? "blue" : listing.pl_mpi_next_30 >= 1 ? "green" : listing.pl_mpi_next_30 >= 0.8 ? "amber" : "red") : undefined}
                  />
                  <ListingKPI
                    label="Last Booked"
                    value={listing.pl_last_booked_date ? new Date(listing.pl_last_booked_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  />
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <AddListingDialog
        open={addListingOpen}
        onOpenChange={setAddListingOpen}
        clientId={client.id}
      />

      <ClientDialog
        key={editDialogOpen ? "edit" : "closed"}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        client={{
          id: client.id,
          name: client.name,
          email: client.email,
          status: client.status,
          assembly_link: client.assembly_link,
          onboarding_date: client.onboarding_date,
          ending_date: client.ending_date,
          billing_amount: client.billing_amount,
          autopayment_set_up: client.autopayment_set_up,
          stripe_dashboard: client.stripe_dashboard,
        }}
        isSuperAdmin={isSuperAdmin}
      />

      <Dialog open={stripeDialogOpen} onOpenChange={handleStripeDialogOpenChange}>
        <DialogContent className="overflow-hidden sm:max-w-lg">
          <DialogHeader className="min-w-0">
            <DialogTitle>Stripe subscription checkout</DialogTitle>
            <DialogDescription className="max-w-full text-wrap">
              Create a Stripe customer for this Hub client and generate a subscription checkout link.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-w-0 flex-col gap-4 overflow-hidden">
            {!stripeConfigured && (
              <Alert>
                <AlertCircle className="size-4" />
                <AlertTitle>Stripe is not configured</AlertTitle>
                <AlertDescription>
                  Add STRIPE_SECRET_KEY before creating Stripe customers or checkout links.
                </AlertDescription>
              </Alert>
            )}

            {stripeConfigured && (
              <>
                <div className="overflow-hidden rounded-md border bg-muted/30 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {client.email ?? "No email on this Hub client"}
                      </p>
                    </div>
                    <Badge
                      variant={hasStripeCustomer ? "secondary" : "outline"}
                      className="shrink-0"
                    >
                      {hasStripeCustomer ? "Stripe linked" : "No Stripe customer"}
                    </Badge>
                  </div>
                  {hasStripeCustomer && (
                    <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                      {localStripeCustomerIds[0]}
                    </p>
                  )}
                </div>

                {loadingStripeOptions ? (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading subscription types...
                  </div>
                ) : stripeOptionsLoaded && stripeOptions.length === 0 ? (
                  <Alert>
                    <AlertCircle className="size-4" />
                    <AlertTitle>No subscription types found</AlertTitle>
                    <AlertDescription>
                      Stripe options are deduced from existing subscriptions, and none have an active recurring price yet.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
                    <label className="text-sm font-medium" htmlFor="stripe-price">
                      Subscription type
                    </label>
                    <Select
                      value={selectedPriceId}
                      onValueChange={setSelectedPriceId}
                      disabled={!stripeOptionsLoaded || stripeOptions.length === 0}
                    >
                      <SelectTrigger
                        id="stripe-price"
                        className="w-full min-w-0 max-w-full overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
                      >
                        <SelectValue placeholder="Select a subscription type">
                          {selectedOption ? (
                            <span className="block min-w-0 max-w-full truncate">
                              {selectedOption.label} - {formatPriceOption(selectedOption)}
                            </span>
                          ) : null}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-3rem)] overflow-hidden"
                      >
                        {stripeOptions.map((option) => (
                          <SelectItem
                            key={option.priceId}
                            value={option.priceId}
                            className="min-w-0 max-w-full"
                          >
                            <span className="block min-w-0 max-w-full truncate">
                              {option.label} - {formatPriceOption(option)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedOption && (
                      <p className="text-xs text-muted-foreground">
                        Used by {selectedOption.subscriptionCount} existing Stripe subscription
                        {selectedOption.subscriptionCount === 1 ? "" : "s"}.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
                  <label
                    htmlFor="include-onboarding-fee"
                    className="flex cursor-pointer items-start gap-3"
                  >
                    <Checkbox
                      id="include-onboarding-fee"
                      checked={includeOnboardingFee}
                      onCheckedChange={(checked) => setIncludeOnboardingFee(checked === true)}
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-medium">Include onboarding fee</span>
                      <span className="text-xs text-muted-foreground">
                        Included by default for clients without a Stripe customer.
                      </span>
                    </span>
                  </label>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      value={onboardingFeeAmount}
                      onChange={(event) => setOnboardingFeeAmount(event.target.value)}
                      disabled={!includeOnboardingFee}
                      aria-label="Onboarding fee amount"
                      className="max-w-36"
                    />
                    <span className="text-xs text-muted-foreground">one-time</span>
                  </div>
                </div>

                {checkoutUrl && (
                  <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-sm font-medium">Checkout link ready</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {checkoutUrl}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <a href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                          Open Checkout
                          <ExternalLink className="ml-1 size-3" />
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCopyCheckout}>
                        <Copy className="mr-1 size-3" />
                        Copy link
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStripeDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={handleCreateStripeCheckout}
              disabled={
                !stripeConfigured ||
                !selectedPriceId ||
                creatingCheckout ||
                loadingStripeOptions ||
                stripeOptions.length === 0
              }
            >
              {creatingCheckout ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <CreditCard className="mr-1 size-3" />
              )}
              {hasStripeCustomer ? "Create Checkout" : "Create Customer + Checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
