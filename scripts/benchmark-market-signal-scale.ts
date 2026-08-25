import {
  calculateListingVulnerability,
  selectPersistedListingExposures,
} from "@/lib/market-signals/vulnerability"

const listings = 1000
const impacts = 300
const selectedSignals = 5
const startedAt = performance.now()
const exposures: Array<{
  impactId: string
  listingId: string
  score: number
}> = []

for (let impactIndex = 0; impactIndex < impacts; impactIndex += 1) {
  const daysUntilImpact = 1 + (impactIndex % 90)
  for (let listingIndex = 0; listingIndex < listings; listingIndex += 1) {
    const occupancyPct = (listingIndex * 7 + impactIndex * 3) % 100
    const marketOccupancyPct = Math.min(
      100,
      occupancyPct + ((listingIndex + impactIndex) % 35)
    )
    const score = calculateListingVulnerability({
      occupancyPct,
      marketOccupancyPct,
      occupancyStlyPct: Math.min(100, occupancyPct + (listingIndex % 20)),
      medianBookingWindowDays: 30,
      daysUntilImpact,
    }).score
    exposures.push({
      impactId: `impact-${impactIndex}`,
      listingId: `listing-${listingIndex}`,
      score,
    })
  }
}

const persisted = selectPersistedListingExposures(
  exposures,
  new Set(
    Array.from({ length: selectedSignals }, (_, index) => `impact-${index}`)
  ),
  45,
  25
)
const durationMs = Math.round(performance.now() - startedAt)
const naiveRows = listings * impacts

console.log(
  JSON.stringify(
    {
      listings,
      impacts,
      calculations: naiveRows,
      selectedSignals,
      maximumPersistedRows: selectedSignals * 25,
      persistedRows: persisted.length,
      rowReductionPct:
        Math.round((1 - persisted.length / naiveRows) * 10000) / 100,
      durationMs,
      heapUsedMb:
        Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    },
    null,
    2
  )
)
