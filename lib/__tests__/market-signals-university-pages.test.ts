import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  stabilizeObservationTimestamps,
  stripObservationTimestamps,
  type MarketSignalMarket,
} from "@/lib/market-signals/provider"
import {
  fetchUniversityPageEvents,
  normalizeUniversityPageEvent,
  parseUniversityHtmlDateCandidates,
  parseUniversityIcsDateCandidates,
  parseUniversityJsonLdDateCandidates,
  parseUniversityPageQueryConfig,
  parseUniversityRestHtmlDateCandidates,
} from "@/lib/market-signals/university-pages"

const fixture = (name: string) =>
  readFileSync(
    join(process.cwd(), "lib/__tests__/fixtures/university-pages", name),
    "utf8"
  )

const market: MarketSignalMarket = {
  id: "76000000-0000-4000-8000-000000000001",
  name: "Knoxville, TN",
  countryCode: "US",
  timezone: "America/New_York",
  centerLat: 35.9544,
  centerLon: -83.9295,
  radiusMiles: 10,
  kind: "urban",
}

const enabledConfig = parseUniversityPageQueryConfig({
  adapter: "official_page",
  collection_status: "enabled",
  source_role: "canonical",
  institution_slug: "university-of-tennessee-knoxville",
  event_types: ["commencement"],
  match_rules: [
    {
      event_type: "commencement",
      event_name: "UT Knoxville Commencement",
      include_terms: ["commencement", "graduation"],
      exclude_terms: ["archive"],
    },
  ],
  format: "rest_html",
  endpoint_path: "/wp-json/academic-calendar/v1/dates",
  endpoint_query: [{ name: "keyword", value: "Commencement" }],
  max_events: 1,
})

describe("official university page parsing primitives", () => {
  it("parses timezone-aware ICS and preserves distinct annual occurrences", () => {
    const events = parseUniversityIcsDateCandidates(fixture("calendar.ics"), {
      sourceUrl: "https://calendar.example.edu/events.ics",
      timezone: "America/New_York",
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      externalId: "uconn-family-2026@example.edu",
      title: "UConn Family Weekend",
      startDate: "2026-09-25T20:00:00.000Z",
      sourceFormat: "ics",
    })
    expect(events[1].startDate.slice(0, 10)).toBe("2027-10-15")
    expect(events[1].endDate).toBe("2027-10-18T03:59:59.999Z")
  })

  it("parses Event JSON-LD without deriving attendance", () => {
    const events = parseUniversityJsonLdDateCandidates(
      fixture("events.jsonld"),
      {
        sourceUrl: "https://commencement.example.edu/",
        timezone: "America/New_York",
      }
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: "Spring Commencement",
      startDate: "2027-05-08T14:00:00.000Z",
      city: "Storrs",
      region: "CT",
      countryCode: "US",
      sourceFormat: "json_ld",
    })
  })

  it("extracts explicit human-readable HTML dates across future years", () => {
    const events = parseUniversityHtmlDateCandidates(
      fixture("official-page.html"),
      {
        sourceUrl: "https://family.example.edu/",
        timezone: "America/New_York",
      }
    )
    expect(events.map((event) => event.startDate.slice(0, 10))).toEqual([
      "2026-09-25",
      "2027-05-08",
      "2026-10-16",
      "2028-05-06",
      "2029-05-17",
      "2025-05-10",
    ])
    expect(events[0].endDate).toBe("2026-09-28T03:59:59.999Z")
    expect(events[2].endDate).toBe("2026-10-19T03:59:59.999Z")
    expect(events[3].endDate).toBe("2028-05-08T03:59:59.999Z")
    expect(events[4]).toMatchObject({
      title: "Commencement Weekend",
      endDate: "2029-05-21T03:59:59.999Z",
    })
  })

  it("extracts bounded HTML candidates from a first-party REST envelope", () => {
    const events = parseUniversityRestHtmlDateCandidates(
      fixture("wordpress-rest.json"),
      {
        sourceUrl: "https://registrar.example.edu/wp-json/calendar/dates",
        timezone: "America/New_York",
      }
    )
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.startDate.slice(0, 10))).toEqual([
      "2027-05-08",
      "2027-12-11",
    ])
    expect(events.every((event) => event.sourceFormat === "rest_html")).toBe(
      true
    )
    expect(events[0].publishedAt).toBe("2026-09-01T16:00:00.000Z")
  })

  it("rejects malformed calendar dates and unsupported recurring ICS rules", () => {
    expect(
      parseUniversityIcsDateCandidates(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:bad-date\nSUMMARY:Commencement\nDTSTART;VALUE=DATE:20270231\nEND:VEVENT\nEND:VCALENDAR",
        {
          sourceUrl: "https://registrar.uconn.edu/calendar.ics",
          timezone: "America/New_York",
        }
      )
    ).toEqual([])

    expect(() =>
      parseUniversityIcsDateCandidates(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:annual\nSUMMARY:Commencement\nDTSTART;VALUE=DATE:20270508\nRRULE:FREQ=YEARLY\nEND:VEVENT\nEND:VCALENDAR",
        {
          sourceUrl: "https://registrar.uconn.edu/calendar.ics",
          timezone: "America/New_York",
        }
      )
    ).toThrow("bounded recurrence collector")
  })

  it("parses a cross-year HTML range when the year is on the first date", () => {
    const events = parseUniversityHtmlDateCandidates(
      "<h2>Family Weekend</h2><p>December 31, 2026 – January 2</p>",
      {
        sourceUrl: "https://familyweekend.uconn.edu/",
        timezone: "America/New_York",
      }
    )
    expect(events[0]).toMatchObject({
      startDate: "2026-12-31T05:00:00.000Z",
      endDate: "2027-01-03T04:59:59.999Z",
    })
  })
})

describe("official university page fetch boundary", () => {
  it("keeps registry-only configs disabled and requires explicit match rules", async () => {
    const registryOnly = parseUniversityPageQueryConfig({
      adapter: "official_page",
      collection_status: "registry_only",
      source_role: "canonical",
      institution_slug: "university-of-connecticut",
      event_types: ["family_weekend"],
    })
    const fetchImpl = vi.fn()
    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://familyweekend.uconn.edu/",
        officialDomain: "uconn.edu",
        queryConfig: registryOnly,
        market,
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).rejects.toThrow("registry-only")
    expect(fetchImpl).not.toHaveBeenCalled()

    expect(() =>
      parseUniversityPageQueryConfig({
        ...registryOnly,
        collection_status: "enabled",
      })
    ).toThrow("explicit event match rules")
  })

  it("revalidates same-domain redirects and bounds REST results", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (input: string | URL | Request) => {
        const url = new URL(input.toString())
        expect(url.hostname).toBe("registrar.utk.edu")
        expect(url.pathname).toBe("/wp-json/academic-calendar/v1/dates")
        expect(url.searchParams.get("keyword")).toBe("Commencement")
        return new Response(null, {
          status: 302,
          headers: { Location: "https://calendar.utk.edu/commencement.json" },
        })
      })
      .mockImplementationOnce(
        async () =>
          new Response(fixture("wordpress-rest.json"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      )
    const result = await fetchUniversityPageEvents({
      sourceUrl: "https://registrar.utk.edu/academic-calendar/",
      officialDomain: "utk.edu",
      queryConfig: enabledConfig,
      market,
      now: new Date("2026-09-02T12:00:00Z"),
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.totalAvailable).toBe(2)
    expect(result.events).toHaveLength(1)
    expect(result.overflow).toBe(true)
    expect(result.events[0]).toMatchObject({
      title: "UT Knoxville Commencement",
      eventType: "commencement",
    })

    const normalized = normalizeUniversityPageEvent(
      result.events[0],
      market,
      enabledConfig,
      "2026-09-02T12:00:00.000Z"
    )
    expect(normalized.normalized).toMatchObject({
      sourceType: "official_feed",
      category: "commencement",
      attendance: null,
      firstSeenAt: "2026-09-01T16:00:00.000Z",
    })
    expect(normalized.publisher).toBe("calendar.utk.edu")
    expect(normalized.authorityTier).toBe(1)
    expect(normalized.evidenceSummary).toContain("attendance was not inferred")
  })

  it("applies source-specific rules without leaking a prior section heading", async () => {
    const familyConfig = parseUniversityPageQueryConfig({
      adapter: "official_page",
      collection_status: "enabled",
      source_role: "canonical",
      institution_slug: "university-of-connecticut",
      event_types: ["family_weekend"],
      match_rules: [
        {
          event_type: "family_weekend",
          event_name: "UConn Family Weekend",
          include_terms: ["family weekend"],
          exclude_terms: ["archive"],
        },
      ],
      format: "html",
    })
    const result = await fetchUniversityPageEvents({
      sourceUrl: "https://familyweekend.uconn.edu/",
      officialDomain: "uconn.edu",
      queryConfig: familyConfig,
      market,
      now: new Date("2026-09-02T12:00:00Z"),
      fetchImpl: (async () =>
        new Response(fixture("official-page.html"), {
          headers: { "Content-Type": "text/html" },
        })) as typeof fetch,
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      title: "UConn Family Weekend",
      eventType: "family_weekend",
    })
    expect(result.events[0].startDate.slice(0, 10)).toBe("2026-09-25")
  })

  it("keeps synthetic occurrence identity stable when an official date moves", async () => {
    const familyConfig = parseUniversityPageQueryConfig({
      adapter: "official_page",
      collection_status: "enabled",
      source_role: "canonical",
      institution_slug: "university-of-connecticut",
      event_types: ["family_weekend"],
      match_rules: [
        {
          event_type: "family_weekend",
          event_name: "UConn Family Weekend",
          include_terms: ["family weekend"],
          exclude_terms: ["deadline"],
        },
      ],
      format: "html",
    })
    const fetchPage = (dates: string) =>
      fetchUniversityPageEvents({
        sourceUrl: "https://familyweekend.uconn.edu/",
        officialDomain: "uconn.edu",
        queryConfig: familyConfig,
        market,
        now: new Date("2026-01-01T00:00:00Z"),
        fetchImpl: (async () =>
          new Response(
            `<h2>Family Weekend</h2><p>Family Weekend is ${dates}.</p>`,
            { headers: { "Content-Type": "text/html" } }
          )) as typeof fetch,
      })

    const original = await fetchPage("September 25–27, 2026")
    const moved = await fetchPage("September 26–28, 2026")
    expect(original.events[0].externalId).toBe(moved.events[0].externalId)
    expect(original.events[0].startDate).not.toBe(moved.events[0].startDate)
  })

  it("does not classify registration deadlines as commencement events", async () => {
    const commencementConfig = parseUniversityPageQueryConfig({
      adapter: "official_page",
      collection_status: "enabled",
      source_role: "canonical",
      institution_slug: "university-of-connecticut",
      event_types: ["commencement"],
      match_rules: [
        {
          event_type: "commencement",
          event_name: "UConn Commencement",
          include_terms: ["commencement"],
          exclude_terms: ["registration opens", "deadline"],
        },
      ],
      format: "html",
    })
    const result = await fetchUniversityPageEvents({
      sourceUrl: "https://commencement.uconn.edu/",
      officialDomain: "uconn.edu",
      queryConfig: commencementConfig,
      market,
      now: new Date("2026-01-01T00:00:00Z"),
      fetchImpl: (async () =>
        new Response(
          "<h2>Commencement</h2><p>Ticket registration opens May 1, 2027.</p><p>The Commencement ceremony is May 16, 2027.</p>",
          { headers: { "Content-Type": "text/html" } }
        )) as typeof fetch,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].startDate.slice(0, 10)).toBe("2027-05-16")
  })

  it("clamps third-party event links to the fetched official evidence page", async () => {
    const jsonConfig = parseUniversityPageQueryConfig({
      adapter: "official_page",
      collection_status: "enabled",
      source_role: "canonical",
      institution_slug: "university-of-connecticut",
      event_types: ["commencement"],
      match_rules: [
        {
          event_type: "commencement",
          event_name: "UConn Commencement",
          include_terms: ["commencement"],
        },
      ],
      format: "json_ld",
    })
    const result = await fetchUniversityPageEvents({
      sourceUrl: "https://commencement.uconn.edu/events.json",
      officialDomain: "uconn.edu",
      queryConfig: jsonConfig,
      market,
      now: new Date("2026-01-01T00:00:00Z"),
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            "@type": "Event",
            name: "UConn Commencement",
            startDate: "2027-05-16",
            url: "https://tickets.example.com/uconn",
          }),
          { headers: { "Content-Type": "application/ld+json" } }
        )) as typeof fetch,
    })
    expect(result.events[0].sourceUrl).toBe(
      "https://commencement.uconn.edu/events.json"
    )
    const normalized = normalizeUniversityPageEvent(
      result.events[0],
      market,
      jsonConfig,
      "2026-09-02T12:00:00.000Z"
    )
    expect(normalized.publisher).toBe("commencement.uconn.edu")
    expect(normalized.normalized.firstSeenAt).toBe("2026-09-02T12:00:00.000Z")
  })

  it("does not treat a fresh observation timestamp as changed page content", () => {
    const event = {
      ...parseUniversityJsonLdDateCandidates(fixture("events.jsonld"), {
        sourceUrl: "https://commencement.uconn.edu/",
        timezone: "America/New_York",
      })[0],
      publishedAt: null,
      eventType: "commencement" as const,
    }
    const canonicalConfig = parseUniversityPageQueryConfig({
      ...enabledConfig,
      institution_slug: "university-of-connecticut",
      source_role: "canonical",
    })
    const first = normalizeUniversityPageEvent(
      event,
      market,
      canonicalConfig,
      "2026-09-02T12:00:00.000Z"
    )
    const next = normalizeUniversityPageEvent(
      event,
      market,
      canonicalConfig,
      "2026-09-03T12:00:00.000Z"
    )
    expect(first.timestampsFromObservation).toBe(true)
    expect(stripObservationTimestamps(first.normalized, true)).toStrictEqual(
      stripObservationTimestamps(next.normalized, true)
    )
    expect(
      stabilizeObservationTimestamps({
        incoming: next.normalized,
        previous: first.normalized,
        changeType: "unchanged",
        observedAt: "2026-09-03T12:00:00.000Z",
        timestampsFromObservation: true,
      })
    ).toMatchObject({
      firstSeenAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    })
  })

  it("fails closed on unreviewed registry domains and empty matches", async () => {
    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://registrar.example.edu/",
        officialDomain: "example.edu",
        queryConfig: enabledConfig,
        market,
        fetchImpl: vi.fn() as typeof fetch,
      })
    ).rejects.toThrow("reviewed application allowlist")

    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://registrar.utk.edu/",
        officialDomain: "utk.edu",
        queryConfig: enabledConfig,
        market,
        now: new Date("2026-01-01T00:00:00Z"),
        fetchImpl: (async () =>
          new Response("<h1>No dates announced</h1>", {
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      })
    ).rejects.toThrow("expected at least 1")
  })

  it("rejects off-domain sources, redirects, and oversized responses", async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://evil.example/calendar",
        officialDomain: "utk.edu",
        queryConfig: enabledConfig,
        market,
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).rejects.toThrow("allowlist")
    expect(fetchImpl).not.toHaveBeenCalled()

    const redirectFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/calendar" },
        })
    )
    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://registrar.utk.edu/",
        officialDomain: "utk.edu",
        queryConfig: enabledConfig,
        market,
        fetchImpl: redirectFetch as typeof fetch,
      })
    ).rejects.toThrow("allowlist")

    const oversizedFetch = vi.fn(
      async () =>
        new Response("small", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(512 * 1024 + 1),
          },
        })
    )
    await expect(
      fetchUniversityPageEvents({
        sourceUrl: "https://registrar.utk.edu/",
        officialDomain: "utk.edu",
        queryConfig: enabledConfig,
        market,
        fetchImpl: oversizedFetch as typeof fetch,
      })
    ).rejects.toThrow("byte limit")
  })
})
