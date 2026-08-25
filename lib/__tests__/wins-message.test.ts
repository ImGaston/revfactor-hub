import { describe, expect, it } from "vitest"

import {
  buildWinMessage,
  publicListingName,
  extractNumbers,
  findForbiddenPhrases,
  formatCurrency,
  formatPercent,
  resolveGreetingName,
  sanitizeText,
  shortenListingName,
  templateKeyForCategory,
} from "@/lib/wins-message"

import { makeCandidate, makeEvidence } from "./wins-helpers"

describe("formatting", () => {
  it("renders currency without cents", () => {
    expect(formatCurrency(27646.95, "USD")).toBe("$27,647")
    expect(formatCurrency(0, "USD")).toBe("$0")
  })

  it("respects a non-USD currency", () => {
    // Production carries CAD and EUR reservations alongside USD.
    expect(formatCurrency(1000, "EUR")).toContain("1,000")
    expect(formatCurrency(1000, "CAD")).toContain("1,000")
  })

  it("falls back to USD on an empty currency rather than throwing", () => {
    expect(() => formatCurrency(100, "")).not.toThrow()
  })

  it("renders signed percentages to one decimal", () => {
    expect(formatPercent(0.263869)).toBe("+26.4%")
    expect(formatPercent(-0.154591)).toBe("-15.5%")
    expect(formatPercent(0)).toBe("+0.0%")
  })
})

describe("resolveGreetingName", () => {
  it("accepts a plain personal name", () => {
    expect(resolveGreetingName("Grant Currant")).toBe("Grant")
  })

  it("rejects names carrying embedded identifiers", () => {
    // Real listing/client data mixes separators and locations into names.
    expect(resolveGreetingName("Cabin Near Lake | MD | Steve Singer")).toBeNull()
    expect(resolveGreetingName("Tahoe Vista Retreat · Megan Chezik")).toBeNull()
  })

  it("rejects company-shaped names", () => {
    expect(resolveGreetingName("Jack Aloha Investment LLC")).toBeNull()
    expect(resolveGreetingName("Thea Cabanilla (Topaz Stays LLC)")).toBeNull()
  })

  it("rejects names containing digits", () => {
    expect(resolveGreetingName("1094 Bella Vista")).toBeNull()
  })

  it("rejects empty and absent names", () => {
    expect(resolveGreetingName(null)).toBeNull()
    expect(resolveGreetingName("")).toBeNull()
    expect(resolveGreetingName("  ")).toBeNull()
  })
})

describe("sanitizeText", () => {
  it("strips angle brackets and entities", () => {
    expect(sanitizeText("<b>Rabbit</b> &amp; Run")).toBe("bRabbit/b Run")
  })

  it("collapses whitespace", () => {
    expect(sanitizeText("Rabbit   \n  Run")).toBe("Rabbit Run")
  })

  it("removes zero-width characters that break chat clients", () => {
    expect(sanitizeText("Rabbit​Run")).toBe("Rabbit Run")
  })
})

describe("publicListingName", () => {
  it("drops the internal state/owner suffix Hub listing names carry", () => {
    // 152 of 249 active listings carry a pipe. Without this, the majority of
    // generated messages would leak internal metadata — and sometimes another
    // person's name — into a client-facing message.
    expect(publicListingName("Austin House | TX | Michelle")).toBe("Austin House")
    expect(publicListingName("The Lansing Haus | Jonathan Lam | MI")).toBe("The Lansing Haus")
    expect(publicListingName("The Bourbon Exhale | KY | Thea")).toBe("The Bourbon Exhale")
  })

  it("handles the PriceLabs separators too", () => {
    expect(publicListingName("Cabin Near Lake · Cabin near lake, pet friendly")).toBe(
      "Cabin Near Lake"
    )
    expect(publicListingName("Colorwave Villa -- Huge Game Room & Backyard")).toBe(
      "Colorwave Villa"
    )
  })

  it("leaves a clean name untouched", () => {
    expect(publicListingName("Rabbit Run")).toBe("Rabbit Run")
  })

  it("keeps the full name when splitting would leave nothing useful", () => {
    expect(publicListingName("A | Something Longer")).toBe("A | Something Longer")
  })
})

describe("shortenListingName", () => {
  it("clips a long name on a word boundary", () => {
    // No separator, so publicListingName leaves it whole and the clip applies.
    const long =
      "Spacious 6BR Beach Home with Elevator and Heated Pool Ideal for Large Family Vacations"
    const short = shortenListingName(long)
    expect(short.length).toBeLessThanOrEqual(61)
    expect(short.endsWith("…")).toBe(true)
    expect(short).not.toMatch(/\s…$/)
  })

  it("prefers the public half of a separator-carrying name over clipping it", () => {
    expect(
      shortenListingName(
        "319 27th Street -- Spacious 6BR Beach Home with Elevator & Heated Pool - Ideal for Family Vacations"
      )
    ).toBe("319 27th Street")
  })

  it("leaves a short name untouched", () => {
    expect(shortenListingName("Rabbit Run")).toBe("Rabbit Run")
  })
})

describe("templateKeyForCategory", () => {
  it("maps win categories to templates and refuses the rest", () => {
    expect(templateKeyForCategory("double_win")).toBe("double_win.v1")
    expect(templateKeyForCategory("yoy_positive_steady")).toBe("yoy_steady.v1")
    expect(templateKeyForCategory("market_compass_candidate")).toBe("market_compass.v1")
    expect(templateKeyForCategory("conflicting_signal")).toBeNull()
    expect(templateKeyForCategory("insufficient_data")).toBeNull()
    expect(templateKeyForCategory("no_win")).toBeNull()
  })
})

describe("buildWinMessage", () => {
  it("produces a Double Win message naming the period and both windows", () => {
    const candidate = makeCandidate({
      id: "a",
      category: "double_win",
      listing_name_snapshot: "Rabbit Run",
      client_name_snapshot: "Grant",
      evidence: makeEvidence({
        pickup: { w2: 5335.97, w3: 36794.12 },
        yoy: { ty: 216135.57, stly: 171010.99 },
      }),
    })
    const msg = buildWinMessage(candidate)!
    expect(msg.templateKey).toBe("double_win.v1")
    expect(msg.body).toMatchSnapshot()
    expect(msg.body).toContain("Hi Grant,")
    expect(msg.body).toContain("Aug–Oct 2026")
    expect(msg.body).toContain("$36,794")
    expect(msg.body).toContain("$5,336")
  })

  it("produces a Steady message that says the pace held", () => {
    const candidate = makeCandidate({
      id: "b",
      category: "yoy_positive_steady",
      evidence: makeEvidence({
        pickup: { w2: 6842.75, w3: 7843.44 },
        yoy: { ty: 67305.75, stly: 51900.55 },
      }),
    })
    const msg = buildWinMessage(candidate)!
    expect(msg.body).toContain("held steady")
    expect(msg.body).toMatchSnapshot()
  })

  it("produces a cautious Market Compass message with no percentage at all", () => {
    const candidate = makeCandidate({
      id: "c",
      category: "market_compass_candidate",
      listing_name_snapshot: "The Lansing Haus",
      evidence: makeEvidence({
        pickup: { w2: 17853, w3: 18670.92 },
        yoy: { ty: 18670.92, stly: 0 },
        revparIndex: 179.53,
      }),
    })
    const msg = buildWinMessage(candidate)!
    expect(msg.body).toContain("RevPAR Index")
    expect(msg.body).toContain("does not yet have a comparable prior-year period")
    // A no-STLY listing must never carry a year-over-year percentage.
    expect(msg.body).not.toContain("%")
    expect(msg.body).toMatchSnapshot()
  })

  it("refuses to draft a message for a conflicting signal", () => {
    expect(buildWinMessage(makeCandidate({ id: "d", category: "conflicting_signal" }))).toBeNull()
    expect(buildWinMessage(makeCandidate({ id: "e", category: "insufficient_data" }))).toBeNull()
  })

  it("omits the percentage when STLY is zero", () => {
    const msg = buildWinMessage(
      makeCandidate({
        id: "f",
        category: "double_win",
        evidence: makeEvidence({ pickup: { w2: 9749, w3: 16427 }, yoy: { ty: 27646, stly: 0 } }),
      })
    )!
    expect(msg.body).not.toContain("%")
    expect(msg.body).toContain("$27,646")
  })

  it("omits the percentage on a tiny STLY base", () => {
    // Without this the workbook's "+18,013% vs STLY" would reach a client.
    const msg = buildWinMessage(
      makeCandidate({
        id: "g",
        category: "double_win",
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 3000 }, yoy: { ty: 45102, stly: 249 } }),
      })
    )!
    expect(msg.body).not.toContain("%")
  })

  it("never leaks the internal state/owner suffix into the message", () => {
    const msg = buildWinMessage(
      makeCandidate({
        id: "h0",
        category: "double_win",
        listing_name_snapshot: "Austin House | TX | Michelle",
      })
    )!
    expect(msg.body).toContain("Austin House")
    expect(msg.body).not.toContain("|")
    expect(msg.body).not.toContain("Michelle")
  })

  it("greets neutrally when the client name is not trustworthy", () => {
    const msg = buildWinMessage(
      makeCandidate({ id: "h", category: "double_win", client_name_snapshot: "Topaz Stays LLC" })
    )!
    expect(msg.body).toContain("Hi there,")
  })

  it("drops the ratio when the prior window was empty", () => {
    const msg = buildWinMessage(
      makeCandidate({
        id: "i",
        category: "double_win",
        evidence: makeEvidence({ pickup: { w2: 0, w3: 16427.68 }, yoy: { ty: 60000, stly: 50000 } }),
      })
    )!
    expect(msg.body).toContain("$16,428")
    expect(msg.body).not.toContain("versus $0")
  })

  it("stays within the length budget", () => {
    const msg = buildWinMessage(
      makeCandidate({
        id: "j",
        category: "double_win",
        listing_name_snapshot:
          "319 27th Street -- Spacious 6BR Beach Home with Elevator & Heated Pool - Ideal for Family Vacations",
      })
    )!
    expect(msg.body.length).toBeLessThanOrEqual(700)
  })

  it("is deterministic", () => {
    const candidate = makeCandidate({ id: "k", category: "double_win" })
    expect(buildWinMessage(candidate)!.body).toBe(buildWinMessage(candidate)!.body)
  })

  it("never claims causality or promises a result", () => {
    for (const category of ["double_win", "yoy_positive_steady", "market_compass_candidate"] as const) {
      const msg = buildWinMessage(makeCandidate({ id: `l-${category}`, category }))!
      expect(findForbiddenPhrases(msg.body)).toEqual([])
    }
  })

  it("never states or implies the message was sent", () => {
    const msg = buildWinMessage(makeCandidate({ id: "m", category: "double_win" }))!
    expect(msg.body.toLowerCase()).not.toContain("sent")
    expect(msg.body.toLowerCase()).not.toContain("we messaged")
  })
})

describe("every figure in the message exists in the evidence", () => {
  // This is the acceptance criterion "the suggested text contains only figures
  // present in the evidence", made executable. A template that invents a
  // number fails here rather than in front of a client.
  const cases = [
    {
      name: "double win",
      candidate: makeCandidate({
        id: "n1",
        category: "double_win",
        evidence: makeEvidence({
          pickup: { w2: 5335.97, w3: 36794.12 },
          yoy: { ty: 216135.57, stly: 171010.99 },
        }),
      }),
    },
    {
      name: "steady",
      candidate: makeCandidate({
        id: "n2",
        category: "yoy_positive_steady",
        evidence: makeEvidence({
          pickup: { w2: 6842.75, w3: 7843.44 },
          yoy: { ty: 67305.75, stly: 51900.55 },
        }),
      }),
    },
    {
      name: "market compass",
      candidate: makeCandidate({
        id: "n3",
        category: "market_compass_candidate",
        evidence: makeEvidence({
          pickup: { w2: 17853, w3: 18670.92 },
          yoy: { ty: 18670.92, stly: 0 },
          revparIndex: 179.53,
        }),
      }),
    },
    {
      name: "zero prior window",
      candidate: makeCandidate({
        id: "n4",
        category: "double_win",
        evidence: makeEvidence({ pickup: { w2: 0, w3: 16427.68 }, yoy: { ty: 27646.95, stly: 0 } }),
      }),
    },
  ]

  it.each(cases)("$name", ({ candidate }) => {
    const msg = buildWinMessage(candidate)!
    const e = candidate.evidence

    // Every figure the templates are allowed to draw on, at the same rounding
    // the formatters apply. "31" is the window length, which is structural.
    const allowed = new Set<number>([31])
    const permit = (v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return
      allowed.add(Math.round(v))
      allowed.add(Math.round(Math.abs(v)))
      allowed.add(Number(Math.abs(v * 100).toFixed(1)))
      allowed.add(Number((v * 100).toFixed(1)))
    }
    permit(e.pickup.w2)
    permit(e.pickup.w3)
    permit(e.pickup.delta_abs)
    permit(e.pickup.change_pct)
    permit(e.yoy.revenue_ty)
    permit(e.yoy.revenue_stly)
    permit(e.yoy.delta_abs)
    permit(e.yoy.pct)
    permit(e.market.revpar_index)
    permit(e.occupancy.gap_pp)
    // The period label carries a year, which is part of the evidence too.
    allowed.add(Number(e.period.start.slice(0, 4)))

    for (const n of extractNumbers(msg.body)) {
      expect(
        allowed.has(n),
        `"${n}" appears in the message but not in the evidence:\n${msg.body}`
      ).toBe(true)
    }
  })
})
