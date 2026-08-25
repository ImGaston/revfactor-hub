"use client"

// Shared clipboard helper.
//
// Extracted verbatim from components/clients/pricing-dashboard-button.tsx,
// which was the only copy path in the app that degraded instead of failing
// silently. Every other call site calls navigator.clipboard directly and
// breaks in browsers that expose the API but reject the request (Safari
// outside a user gesture, insecure origins, hardened enterprise policies).
//
// Returns a boolean rather than throwing so callers can decide what to show —
// a copy that failed must never be reported as a copy that worked.

function copyWithLegacyFallback(value: string): boolean {
  const textarea = document.createElement("textarea")
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null

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

export async function copyToClipboard(value: string): Promise<boolean> {
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

/**
 * Open an external URL in a new tab, reporting whether the popup survived.
 *
 * `noopener,noreferrer` matters here: without noopener the opened tab gets a
 * live `window.opener` handle back into the Hub session.
 */
export function openExternal(url: string): boolean {
  const win = window.open(url, "_blank", "noopener,noreferrer")
  return win !== null
}
