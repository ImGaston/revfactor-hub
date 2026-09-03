# Market Registry Census

Status: read-only planning evidence, 2026-09-02. Counts in the proposed census are PriceLabs source rows unless explicitly labeled as Hub listings. Source rows can include channel duplicates or parent/child inventory and must be reconciled through the Hub/PriceLabs identity crosswalk before a database backfill.

Implementation note: pending migration `20260902203400_market_registry_initial_proposals.sql` copies the 25 tabulated high-confidence markets and 13 straightforward same-city candidates into `revenue_market_proposals` as `needs_review` research records. It stores aggregate counts, confidence, canonical locality candidates, and exception codes only. It creates no market, locality, listing membership, event, job, or external side effect, and it deliberately leaves proposal geometry unset until review.

## Inventory Snapshot

- Latest authenticated Hub evidence: 257 active listings.
- Current production registry evidence: five active markets covering 52 Hub listings (Smokies 40, Washington DC 3, Tucson 7, Myrtle Beach 1, Park City 1).
- Approximate active Hub listings outside the five-market registry: 205.
- Current PriceLabs read: 358 syncing and visible rows, 453 total visible rows, coordinates present for all 358 syncing rows, and 176 distinct raw city/state/country labels.
- 115 raw location labels occur once. One-listing markets are valid and should become proposals instead of being forced into an unrelated metro.

## Assignment Policy

Each active Hub listing must have exactly one primary revenue market. It may have zero or more secondary influence markets. Assignment order is:

1. Preserve an explicit/manual override.
2. Preserve an existing approved primary assignment.
3. Match an exact canonical locality or alias.
4. Match a point inside a reviewed geographic boundary.
5. Suggest the nearest compatible market inside the same region.
6. Create a draft one-listing or new-market proposal.
7. Leave the listing unresolved when its geography conflicts or is incomplete.

Pure proximity must never be authoritative. A 25-mile connected-component calculation merges Knoxville into the Smokies, and even a 20-mile listing chain can do so. Canonical localities and reviewed boundaries therefore outrank radius.

## High-Confidence Initial Markets

| State | Primary market              | Canonical localities                                                 | Source rows |
| ----- | --------------------------- | -------------------------------------------------------------------- | ----------: |
| TN    | Smoky Mountains             | Gatlinburg, Sevierville, Pigeon Forge, Pittman Center                |          48 |
| TN    | Knoxville                   | Knoxville                                                            |           1 |
| TN    | Nashville                   | Nashville                                                            |           1 |
| SC    | Myrtle Beach / Grand Strand | North Myrtle Beach, Myrtle Beach                                     |          17 |
| PA    | Poconos                     | Albrightsville, East Stroudsburg, Tobyhanna, Blakeslee, Lake Harmony |           9 |
| WI    | Lake Geneva                 | Lake Geneva, Fontana-on-Geneva Lake                                  |           9 |
| CA    | North Lake Tahoe            | Tahoe Vista, Carnelian Bay, Homewood, Kings Beach, Tahoe City        |           6 |
| TX    | Dallas–Fort Worth           | Dallas, Fort Worth, Arlington, Grand Prairie, Irving                 |           6 |
| MD    | Deep Creek Lake             | McHenry, Oakland                                                     |           2 |
| SD    | Black Hills                 | Keystone, Custer                                                     |           3 |
| OH    | Cincinnati                  | Cincinnati, Loveland                                                 |           4 |
| MT    | Glacier / Whitefish         | Columbia Falls, Whitefish                                            |           2 |
| NC    | Asheville area              | Fairview, Avery Creek                                                |           3 |
| NC    | Lake Lure                   | Lake Lure                                                            |           2 |
| WA    | Olympic Peninsula           | Forks                                                                |           9 |
| WA    | Mount Rainier North         | Enumclaw                                                             |           5 |
| WA    | Mount Rainier South         | Ashford                                                              |           2 |
| UT    | Park City                   | Park City                                                            |           3 |
| UT    | Salt Lake City              | Salt Lake City                                                       |           1 |
| NJ    | Atlantic City coast         | Brigantine                                                           |           6 |
| NJ    | Newark / NYC influence      | Harrison                                                             |           3 |
| CA    | Orange County coast         | Newport Beach                                                        |           8 |
| CA    | Anaheim / Santa Ana         | Anaheim, Santa Ana                                                   |           2 |
| CO    | Denver metro                | Denver, Arvada                                                       |           5 |
| CO    | Boulder                     | Boulder                                                              |           1 |

Straightforward same-city candidates also include Tucson, San Diego, Glenwood Springs, Milwaukee, Austin, Omaha, Lodi, Gainesville, Sedona, Page, Galveston, Charlotte, and Livingston.

## Markets Requiring Review

- North Georgia Mountains: Cleveland, Dahlonega, Mineral Bluff, Blairsville, and Blue Ridge. Preserve eastern/western locality groupings until boundaries are reviewed.
- Shenandoah Valley: Basye and Stanley.
- Hudson Valley / Eastern Catskills: Hudson, Catskill, Saugerties, Durham, and Hillsdale.
- Western Catskills: Hobart and Schenevus.
- Finger Lakes / Central New York: Auburn, Skaneateles, and Cortland; determine whether Cortland is separate.
- Twin Cities: Minneapolis and Hopkins, with Stillwater requiring a primary-market decision.
- Mount Rainier North/South should remain separate primary markets but can share a secondary demand influence.

## Data Quality Exceptions

- One PriceLabs row reports Sevierville, Colorado while its coordinates correspond to Sevierville, Tennessee. Normalize it to `US-TN / Smoky Mountains / Sevierville`, retaining the raw value and an explicit correction reason.
- Three international rows (Canada, Spain, Argentina) legitimately lack a US state. They require country-specific subdivision records rather than a fabricated US state.
- Hub city evidence suggests 44 active Smokies properties while the current radius approves 40. Review the four excluded local-area properties during locality-based backfill.

## Backfill Contract

Use one staged row per source record with: source system and record key, Hub listing ID, listing status, country/state, raw city, normalized locality, coordinates, primary market, secondary markets, assignment basis, confidence, exception code, and source observation time.

For 1,000+ listings, process only changed-record fingerprints after the initial backfill, use set-based geographic joins, and never use PriceLabs groups/tags as geographic truth.

## Acceptance Checks

- Active Hub total equals primary assignments plus unresolved listings.
- No active listing has more than one approved primary market.
- Smokies contains the four canonical localities and excludes Knoxville and Nashville.
- Raw and normalized geography remain auditable.
- Every syncing PriceLabs row reconciles to a Hub property, a duplicate/channel-only record, or an explicit unresolved record.
- International records use correct country/subdivision semantics.
- Re-running the same input is idempotent and processes only changed listings after the initial run.
- Grok receives no customer names, addresses, listing IDs, or exact property coordinates.
- A 1,000-row dry run creates zero duplicate primaries and completes within the worker budget.
