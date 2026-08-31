import type { Metadata } from "next"
import Image from "next/image"
import { notFound } from "next/navigation"

import { getPublicListingReview } from "@/lib/listing-reviews.server"
import { ListingReviewForm } from "./listing-review-form"

export const metadata: Metadata = {
  title: "Listing review | RevFactor",
  description:
    "Securely share property revenue details for a RevFactor listing review.",
  robots: { index: false, follow: false },
}

export default async function ListingReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const request = await getPublicListingReview(token)
  if (!request) notFound()

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/revfactor-logo/RevFactor_Favicon_Cedar.png"
              alt="RevFactor"
              width={40}
              height={40}
              priority
            />
            <div>
              <p className="text-sm font-semibold tracking-wide text-foreground">
                REVFACTOR
              </p>
              <p className="text-xs text-muted-foreground">
                Secure listing review
              </p>
            </div>
          </div>
          <span className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-e1">
            Private link
          </span>
        </header>

        <ListingReviewForm request={request} />
      </div>
    </main>
  )
}
