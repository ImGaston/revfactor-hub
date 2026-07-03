// Airbnb serves its Open Graph tags to browser user agents only; a default
// server fetch UA gets a bot wall. The HTML (~700 KB) stays under Vercel's
// 2 MB data-cache limit, so we cache the page fetch for 24h per listing.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

const FETCH_TIMEOUT_MS = 4000

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function fetchOgImage(roomUrl: string): Promise<string | null> {
  const res = await fetch(roomUrl, {
    headers: { "User-Agent": BROWSER_UA },
    next: { revalidate: 86400 },
  })
  if (!res.ok) return null
  const html = await res.text()
  const match = html.match(
    /<meta\s+property="og:image"\s+content="([^"]+)"/
  )
  return match ? decodeHtmlEntities(match[1]) : null
}

/**
 * Extract the Open Graph image URL from an Airbnb room page, for use as the
 * og:image of the public Adjustments share card. Returns null on any failure
 * (bot wall, timeout, missing tag) so callers can fall back to the default
 * image. Racing a timer instead of aborting keeps the fetch cacheable.
 */
export async function getAirbnbOgImage(roomUrl: string): Promise<string | null> {
  try {
    return await Promise.race([
      fetchOgImage(roomUrl),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)
      ),
    ])
  } catch {
    return null
  }
}
