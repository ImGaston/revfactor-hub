import { cache } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  adjustmentStatusLabel,
  adjustmentSummary,
  type AdjustmentSummaryFields,
} from "@/lib/adjustments"
import type { Adjustment, AdjustmentComment } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { AdjustmentShell, AdjustmentCard } from "./adjustment-card"

// Non-sensitive fields only: this shape is served without auth (WhatsApp's OG
// scraper and anyone with the link). No origin message, no requester, no people.
type PublicAdjustment = AdjustmentSummaryFields & {
  id: string
  public_token: string
  booking_window: Adjustment["booking_window"]
  urgency: Adjustment["urgency"]
  status: Adjustment["status"]
  created_at: string
  listings: Adjustment["listings"]
}

const getPublicAdjustment = cache(
  async (token: string): Promise<PublicAdjustment | null> => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("adjustments")
      .select(
        `id, public_token, scope, tag, target_value, date_from, date_to,
         booking_window, urgency, status, created_at,
         clients(name),
         listings(id, name, listing_id, pricelabs_link, airbnb_link)`
      )
      .eq("public_token", token)
      .single()
    return data as unknown as PublicAdjustment | null
  }
)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const adjustment = await getPublicAdjustment(token)
  if (!adjustment) return { title: "Adjustment not found" }

  const title = adjustmentSummary(adjustment)
  const description = [
    adjustment.clients?.name,
    `${adjustment.urgency} urgency`,
    adjustmentStatusLabel(adjustment.status),
  ]
    .filter(Boolean)
    .join(" · ")

  return {
    metadataBase: new URL("https://hub.revfactor.io"),
    title: `${title} — RevFactor Adjustment`,
    description,
    openGraph: {
      title,
      description,
      siteName: "RevFactor Hub",
      images: ["/revfactor-logo/RevFactor_Favicon_Cedar.png"],
    },
  }
}

export default async function AdjustmentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const publicAdjustment = await getPublicAdjustment(token)
  if (!publicAdjustment) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Public shell: read-only, non-sensitive info + shortcuts, no actions
    return (
      <PageFrame>
        <AdjustmentShell adjustment={publicAdjustment} />
        <div className="mt-4 text-center">
          <Button asChild variant="outline" size="sm">
            <Link href={`/login?next=/a/${token}`}>Log in to work on this</Link>
          </Button>
        </div>
      </PageFrame>
    )
  }

  // Authenticated core: full card with notes and actions (RLS applies)
  const [{ data: adjustment }, { data: comments }, canEdit, canControl] =
    await Promise.all([
      supabase
        .from("adjustments")
        .select(
          `*,
           clients:clients_basic(id, name),
           listings(id, name, listing_id, pricelabs_link, airbnb_link),
           resolver:profiles!adjustments_resolver_id_fkey(full_name, email),
           reviewer:profiles!adjustments_reviewer_id_fkey(full_name, email)`
        )
        .eq("public_token", token)
        .single(),
      supabase
        .from("adjustment_comments")
        .select("*, profiles(full_name, email, avatar_url)")
        .eq("adjustment_id", publicAdjustment.id)
        .order("created_at", { ascending: true }),
      hasPermission("adjustments", "edit"),
      hasPermission("adjustments", "control"),
    ])

  if (!adjustment) notFound()

  return (
    <PageFrame>
      <AdjustmentCard
        adjustment={adjustment as unknown as Adjustment}
        comments={(comments ?? []) as unknown as AdjustmentComment[]}
        currentUserId={user.id}
        canEdit={canEdit}
        canControl={canControl}
      />
    </PageFrame>
  )
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      {children}
    </main>
  )
}
