// Display helpers for a captured client message: links shown as one short,
// clickable label, and the Assembly chat the message came from. Pure and
// client-safe; nothing here calls Assembly.

import { SUPPORT_REDACTED_CREDENTIAL } from "@/lib/support-tickets"

export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "link"; href: string; label: string }
  /** A link the capture bot broke by redacting part of it; `raw` keeps its query (dates, guests) */
  | { type: "broken-link"; label: string; raw: string }

// The redaction marker has a space and brackets, which would split a URL
const MARKER_TOKEN = "\u0000redacted\u0000"
// `[label](url)` as Assembly sends it; the url has no spaces once the marker is swapped
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
// Bare URLs, minus trailing punctuation
const BARE_URL = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/g
const LABEL_MAX = 60

function restoreMarker(text: string): string {
  return text.split(MARKER_TOKEN).join(SUPPORT_REDACTED_CREDENTIAL)
}

/** `https://www.airbnb.com/rooms/123?check_in=…` → `airbnb.com/rooms/123` */
export function shortLinkLabel(url: string): string {
  // A URL-safe stand-in for the removed value, shown as "…"
  const clean = url.split(MARKER_TOKEN).join("REDACTEDVALUE")
  let label: string
  try {
    const parsed = new URL(clean)
    let path = parsed.pathname.replace(/\/$/, "")
    try {
      path = decodeURIComponent(path)
    } catch {
      /* keep the encoded path */
    }
    label = `${parsed.hostname.replace(/^www\./, "")}${path}`
  } catch {
    label = clean.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "")
  }
  label = label.split("REDACTEDVALUE").join("…")
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label
}

function linkSegment(url: string): MessageSegment {
  return url.includes(MARKER_TOKEN)
    ? { type: "broken-link", label: shortLinkLabel(url), raw: restoreMarker(url) }
    : { type: "link", href: url, label: shortLinkLabel(url) }
}

/**
 * Splits a message into text and links. A markdown link whose label is a URL
 * (Assembly's `[url](url)`) becomes one link; a named one keeps its name.
 */
export function messageSegments(text: string | null | undefined): MessageSegment[] {
  if (!text) return []
  const source = text.split(SUPPORT_REDACTED_CREDENTIAL).join(MARKER_TOKEN)
  const out: MessageSegment[] = []
  const pushText = (chunk: string) => {
    if (!chunk) return
    const last = out[out.length - 1]
    if (last?.type === "text") last.text += restoreMarker(chunk)
    else out.push({ type: "text", text: restoreMarker(chunk) })
  }
  const pushBare = (chunk: string) => {
    let cursor = 0
    for (const match of chunk.matchAll(BARE_URL)) {
      pushText(chunk.slice(cursor, match.index))
      out.push(linkSegment(match[0]))
      cursor = match.index + match[0].length
    }
    pushText(chunk.slice(cursor))
  }

  let cursor = 0
  for (const match of source.matchAll(MARKDOWN_LINK)) {
    pushBare(source.slice(cursor, match.index))
    const [, label, url] = match
    const segment = linkSegment(url)
    if (segment.type === "link" && !/^https?:\/\//i.test(label)) segment.label = restoreMarker(label)
    out.push(segment)
    cursor = match.index + match[0].length
  }
  pushBare(source.slice(cursor))
  return out
}

/**
 * The client's Assembly chat (company chat first, as Assembly threads them).
 * Assembly has no link to a single message, so the page shows the send time
 * next to it.
 */
export function supportAssemblyThreadUrl(
  client: { assembly_client_id: string | null; assembly_company_id: string | null } | null
): string | null {
  if (client?.assembly_company_id) return `https://dashboard.assembly.com/companies/${client.assembly_company_id}/messages`
  if (client?.assembly_client_id)
    return `https://dashboard.assembly.com/clients/users/details/${client.assembly_client_id}/messages`
  return null
}
