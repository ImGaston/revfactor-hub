"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

type CopyState = "idle" | "copied" | "error"

function copyWithLegacyFallback(value: string) {
  const textarea = document.createElement("textarea")
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.inset = "0 auto auto 0"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    activeElement?.focus()
  }
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through for browsers that expose the API but reject the request.
    }
  }

  return copyWithLegacyFallback(value)
}

export function PricingDashboardButton({
  dashboardUrl,
}: {
  dashboardUrl: string | null
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const hasDashboardUrl = Boolean(dashboardUrl)

  useEffect(() => {
    if (copyState === "idle") return

    const timeout = window.setTimeout(() => setCopyState("idle"), 2500)
    return () => window.clearTimeout(timeout)
  }, [copyState])

  async function handleCopy() {
    if (!dashboardUrl) return

    const copied = await copyToClipboard(dashboardUrl)
    if (copied) {
      setCopyState("copied")
      toast.success("Dashboard link copied")
      return
    }

    setCopyState("error")
    toast.error("Could not copy dashboard link")
  }

  const statusMessage = !hasDashboardUrl
    ? "Dashboard link unavailable"
    : copyState === "copied"
      ? "Dashboard link copied"
      : copyState === "error"
        ? "Could not copy dashboard link"
        : "Private dashboard link"

  const buttonLabel = !hasDashboardUrl
    ? "Dashboard link unavailable"
    : copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Copy failed"
        : "Copy embed link"

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        disabled={!hasDashboardUrl}
        aria-describedby="pricing-dashboard-status"
        title={
          hasDashboardUrl
            ? "Copy private Pricing Dashboard embed link"
            : "Dashboard link unavailable"
        }
      >
        {copyState === "copied" ? (
          <Check data-icon="inline-start" />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {buttonLabel}
      </Button>
      <span
        id="pricing-dashboard-status"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </span>
    </>
  )
}
