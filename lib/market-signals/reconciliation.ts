import { classifyEventChange } from "@/lib/market-signals/domain"
import type { MarketEventChangeType } from "@/lib/market-signals/contracts"
import type { NormalizedProviderEvent } from "@/lib/market-signals/contracts"

const OCCURRENCE_CLUSTER_DAYS = 14

export type UniversityEventObservation = {
  sourceId: string
  institutionSlug: string
  sourceRole: "canonical" | "corroborating"
  observedAt: string
  normalized: NormalizedProviderEvent
}

export type ReconciliationConflict = {
  field: "startDate" | "endDate" | "title" | "providerStatus"
  canonicalValue: string | null
  observedValue: string | null
  sourceId: string
}

export type ReconciledUniversityOccurrence = {
  occurrenceKey: string
  seriesKey: string
  occurrenceYear: number
  occurrenceQuarter: number
  canonical: UniversityEventObservation
  observations: UniversityEventObservation[]
  corroboratingCount: number
  conflicts: ReconciliationConflict[]
}

export type ReconciliationOutcome = {
  occurrenceKey: string
  kind: "new" | "unchanged" | "changed" | "missing"
  changeType: MarketEventChangeType | "missing"
  occurrence: ReconciledUniversityOccurrence | null
  previous: ReconciledUniversityOccurrence | null
  missingSourceId: string | null
  missingExternalId: string | null
}

export type UniversitySnapshotReconciliation = {
  occurrences: ReconciledUniversityOccurrence[]
  outcomes: ReconciliationOutcome[]
  missing: ReconciliationOutcome[]
  conflictCount: number
}

function normalizedTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function occurrenceParts(observation: UniversityEventObservation) {
  const date = new Date(observation.normalized.startDate)
  const year = date.getUTCFullYear()
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  const seriesKey = [
    observation.institutionSlug,
    observation.normalized.category,
    normalizedTitle(observation.normalized.title),
    String(year),
    `q${quarter}`,
  ].join("|")
  return { year, quarter, seriesKey, time: date.getTime() }
}

function sourceExternalKey(observation: UniversityEventObservation) {
  return `${observation.sourceId}|${observation.normalized.externalId}`
}

function observationSort(
  first: UniversityEventObservation,
  second: UniversityEventObservation
) {
  const firstTime = new Date(first.normalized.startDate).getTime()
  const secondTime = new Date(second.normalized.startDate).getTime()
  return (
    firstTime - secondTime ||
    first.sourceId.localeCompare(second.sourceId) ||
    first.normalized.externalId.localeCompare(second.normalized.externalId)
  )
}

function chooseCanonical(observations: UniversityEventObservation[]) {
  return [...observations].sort((first, second) => {
    if (first.sourceRole !== second.sourceRole) {
      return first.sourceRole === "canonical" ? -1 : 1
    }
    return (
      second.observedAt.localeCompare(first.observedAt) ||
      first.sourceId.localeCompare(second.sourceId)
    )
  })[0]
}

function valuesDiffer(first: string | null, second: string | null) {
  return first !== second
}

function conflictsFor(
  canonical: UniversityEventObservation,
  observations: UniversityEventObservation[]
) {
  const fields: Array<{
    field: ReconciliationConflict["field"]
    read: (observation: UniversityEventObservation) => string | null
  }> = [
    { field: "startDate", read: (item) => item.normalized.startDate },
    { field: "endDate", read: (item) => item.normalized.endDate },
    { field: "title", read: (item) => item.normalized.title },
    {
      field: "providerStatus",
      read: (item) => item.normalized.providerStatus,
    },
  ]
  return observations.flatMap((observation) =>
    fields.flatMap(({ field, read }) => {
      const canonicalValue = read(canonical)
      const observedValue = read(observation)
      if (
        observation.sourceId === canonical.sourceId &&
        observation.normalized.externalId === canonical.normalized.externalId
      ) {
        return []
      }
      return valuesDiffer(canonicalValue, observedValue)
        ? [
            {
              field,
              canonicalValue,
              observedValue,
              sourceId: observation.sourceId,
            },
          ]
        : []
    })
  )
}

/**
 * Reconciles a batch of university observations without performing I/O.
 * Occurrences are clustered within a 14-day window so a registrar date that
 * differs by a few days remains corroborating evidence for the same event.
 */
export function reconcileUniversityObservations(
  observations: UniversityEventObservation[]
) {
  const bySeries = new Map<string, UniversityEventObservation[]>()
  for (const observation of observations) {
    const { seriesKey } = occurrenceParts(observation)
    const group = bySeries.get(seriesKey) ?? []
    group.push(observation)
    bySeries.set(seriesKey, group)
  }

  const result: ReconciledUniversityOccurrence[] = []
  for (const [seriesKey, group] of bySeries) {
    const sorted = [...group].sort(observationSort)
    const clusters: UniversityEventObservation[][] = []
    for (const observation of sorted) {
      const priorCluster = clusters.at(-1)
      const priorObservation = priorCluster?.at(-1)
      const withinDrift =
        priorObservation &&
        occurrenceParts(observation).time -
          occurrenceParts(priorObservation).time <=
          OCCURRENCE_CLUSTER_DAYS * 86_400_000
      if (!priorCluster || !withinDrift) clusters.push([observation])
      else priorCluster.push(observation)
    }

    clusters.forEach((cluster, index) => {
      const canonical = chooseCanonical(cluster)
      const { year, quarter } = occurrenceParts(canonical)
      result.push({
        occurrenceKey: `${seriesKey}|${index + 1}`,
        seriesKey,
        occurrenceYear: year,
        occurrenceQuarter: quarter,
        canonical,
        observations: [...cluster].sort(observationSort),
        corroboratingCount: cluster.filter(
          (item) => item.sourceRole === "corroborating"
        ).length,
        conflicts: conflictsFor(canonical, cluster),
      })
    })
  }
  return result.sort((first, second) =>
    first.occurrenceKey.localeCompare(second.occurrenceKey)
  )
}

/**
 * Compares two completed/in-progress source snapshots. Missing detection is
 * deliberately disabled for incremental or incomplete snapshots: an empty
 * page, a capped response, or a source failure must never retire an event.
 */
export function reconcileUniversitySnapshot(input: {
  previous: UniversityEventObservation[]
  current: UniversityEventObservation[]
  completeSourceIds: ReadonlySet<string>
  asOf: Date
}): UniversitySnapshotReconciliation {
  const occurrences = reconcileUniversityObservations(input.current)
  const previousOccurrences = reconcileUniversityObservations(input.previous)
  const previousByKey = new Map(
    previousOccurrences.map((occurrence) => [
      occurrence.occurrenceKey,
      occurrence,
    ])
  )
  const outcomes: ReconciliationOutcome[] = occurrences.map((occurrence) => {
    const previous = previousByKey.get(occurrence.occurrenceKey) ?? null
    const changeType = previous
      ? classifyEventChange(
          previous.canonical.normalized,
          occurrence.canonical.normalized
        )
      : "new"
    return {
      occurrenceKey: occurrence.occurrenceKey,
      kind:
        changeType === "unchanged" ? "unchanged" : previous ? "changed" : "new",
      changeType,
      occurrence,
      previous,
      missingSourceId: null,
      missingExternalId: null,
    }
  })

  const currentExternalKeys = new Set(input.current.map(sourceExternalKey))
  const missing: ReconciliationOutcome[] = []
  if (input.completeSourceIds.size > 0) {
    for (const prior of input.previous) {
      if (!input.completeSourceIds.has(prior.sourceId)) continue
      if (new Date(prior.normalized.endDate).getTime() < input.asOf.getTime()) {
        continue
      }
      const key = sourceExternalKey(prior)
      if (currentExternalKeys.has(key)) continue
      const occurrence = previousOccurrences.find((item) =>
        item.observations.some(
          (observation) => sourceExternalKey(observation) === key
        )
      )
      missing.push({
        occurrenceKey: occurrence?.occurrenceKey ?? key,
        kind: "missing",
        changeType: "missing",
        occurrence: null,
        previous: occurrence ?? null,
        missingSourceId: prior.sourceId,
        missingExternalId: prior.normalized.externalId,
      })
    }
  }

  return {
    occurrences,
    outcomes: [...outcomes, ...missing],
    missing,
    conflictCount: occurrences.reduce(
      (count, occurrence) => count + occurrence.conflicts.length,
      0
    ),
  }
}
