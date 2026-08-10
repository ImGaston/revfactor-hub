import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer"

import type { RevenueBriefInput } from "@/lib/revenue-brief/schema"
import type { RevenueBriefBrandTheme } from "@/lib/revenue-brief/brand"

const COLORS = {
  cedar: "#95543D",
  moss: "#405542",
  forest: "#173F35",
  bone: "#F5F0E8",
  sand: "#E9DED0",
  ink: "#17211E",
  muted: "#66716C",
  line: "#D7D5CF",
  white: "#FFFFFF",
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.white,
    color: COLORS.ink,
    fontFamily: "Helvetica",
    fontSize: 8.4,
    height: 792,
    lineHeight: 1.36,
    paddingBottom: 42,
    paddingHorizontal: 44,
    paddingTop: 48,
    width: 612,
  },
  cover: {
    backgroundColor: COLORS.forest,
    color: COLORS.bone,
    padding: 38,
  },
  coverFrame: {
    borderColor: "#7D9187",
    borderRadius: 12,
    borderWidth: 0.8,
    flex: 1,
    padding: 34,
  },
  coverBrand: {
    fontFamily: "Times-Italic",
    fontSize: 26,
    letterSpacing: 0.6,
    marginBottom: 66,
    textAlign: "center",
  },
  coverLogo: {
    height: 58,
    marginBottom: 52,
    objectFit: "contain",
    width: "100%",
  },
  coverBrandLine: {
    fontSize: 7,
    letterSpacing: 1,
    marginBottom: 40,
    marginTop: -39,
    textAlign: "center",
    textTransform: "uppercase",
  },
  eyebrow: {
    color: COLORS.cedar,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.4,
    letterSpacing: 1.1,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  coverEyebrow: {
    color: COLORS.sand,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 1.2,
    marginBottom: 10,
    textAlign: "center",
    textTransform: "uppercase",
  },
  coverTitle: {
    fontFamily: "Times-Roman",
    fontSize: 28,
    lineHeight: 1.05,
    marginBottom: 13,
    textAlign: "center",
  },
  coverLocation: {
    color: COLORS.sand,
    fontSize: 10,
    marginBottom: 8,
    textAlign: "center",
  },
  coverPrepared: {
    color: COLORS.bone,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    marginBottom: 28,
    textAlign: "center",
  },
  coverImage: {
    borderRadius: 6,
    height: 206,
    marginBottom: 22,
    objectFit: "cover",
    width: "100%",
  },
  coverImageFallback: {
    alignItems: "center",
    backgroundColor: "#244B41",
    borderColor: "#6C8177",
    borderRadius: 6,
    borderWidth: 0.7,
    height: 180,
    justifyContent: "center",
    marginBottom: 22,
    overflow: "hidden",
    position: "relative",
  },
  coverRingLarge: {
    borderColor: "#668077",
    borderRadius: 120,
    borderWidth: 0.8,
    height: 210,
    left: 52,
    position: "absolute",
    top: -65,
    width: 210,
  },
  coverRingSmall: {
    borderColor: COLORS.cedar,
    borderRadius: 70,
    borderWidth: 1,
    height: 116,
    position: "absolute",
    right: 52,
    top: 54,
    width: 116,
  },
  coverProperty: {
    color: COLORS.bone,
    fontFamily: "Times-Roman",
    fontSize: 20,
    textAlign: "center",
  },
  coverPurpose: {
    color: COLORS.sand,
    fontSize: 8,
    lineHeight: 1.5,
    marginHorizontal: 20,
    textAlign: "center",
  },
  coverFooter: {
    bottom: 18,
    color: "#C9D1CD",
    fontSize: 6.5,
    left: 38,
    position: "absolute",
    right: 38,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    borderBottomColor: COLORS.line,
    borderBottomWidth: 0.6,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    left: 44,
    paddingBottom: 7,
    position: "absolute",
    right: 44,
    top: 20,
  },
  headerBrand: {
    color: COLORS.forest,
    fontFamily: "Times-Italic",
    fontSize: 10,
  },
  headerLogo: {
    height: 16,
    objectFit: "contain",
    width: 74,
  },
  headerTitle: {
    color: COLORS.muted,
    fontSize: 6.4,
  },
  footer: {
    borderTopColor: COLORS.line,
    borderTopWidth: 0.6,
    bottom: 18,
    color: COLORS.muted,
    display: "flex",
    flexDirection: "row",
    fontSize: 6.3,
    justifyContent: "space-between",
    left: 44,
    paddingTop: 6,
    position: "absolute",
    right: 44,
  },
  title: {
    color: COLORS.forest,
    fontFamily: "Times-Roman",
    fontSize: 22,
    lineHeight: 1.05,
    marginBottom: 8,
  },
  intro: {
    color: COLORS.muted,
    fontSize: 8.8,
    lineHeight: 1.5,
    marginBottom: 17,
  },
  sectionTitle: {
    color: COLORS.forest,
    fontFamily: "Times-Roman",
    fontSize: 14.5,
    marginBottom: 8,
    marginTop: 16,
  },
  metricRow: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  metricCard: {
    backgroundColor: COLORS.bone,
    borderColor: COLORS.line,
    borderRadius: 4,
    borderWidth: 0.6,
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  metricValue: {
    color: COLORS.cedar,
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginBottom: 4,
    textAlign: "center",
  },
  metricLabel: {
    color: COLORS.muted,
    fontFamily: "Helvetica-Bold",
    fontSize: 5.8,
    letterSpacing: 0.7,
    textAlign: "center",
    textTransform: "uppercase",
  },
  callout: {
    backgroundColor: COLORS.bone,
    borderLeftColor: COLORS.cedar,
    borderLeftWidth: 3,
    borderRadius: 3,
    marginBottom: 14,
    padding: 12,
  },
  calloutMoss: {
    backgroundColor: "#EDF1EC",
    borderLeftColor: COLORS.moss,
  },
  calloutTitle: {
    color: COLORS.cedar,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.2,
    marginBottom: 5,
  },
  calloutBody: {
    fontSize: 8.4,
    lineHeight: 1.45,
  },
  table: {
    borderColor: COLORS.line,
    borderLeftWidth: 0.5,
    borderTopWidth: 0.5,
    marginBottom: 7,
    width: "100%",
  },
  row: {
    display: "flex",
    flexDirection: "row",
  },
  headerCell: {
    backgroundColor: COLORS.moss,
    borderBottomColor: COLORS.line,
    borderBottomWidth: 0.5,
    borderRightColor: COLORS.line,
    borderRightWidth: 0.5,
    color: COLORS.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.2,
    lineHeight: 1.15,
    padding: 6,
  },
  cell: {
    borderBottomColor: COLORS.line,
    borderBottomWidth: 0.5,
    borderRightColor: COLORS.line,
    borderRightWidth: 0.5,
    fontSize: 7,
    lineHeight: 1.25,
    padding: 6,
  },
  altCell: {
    backgroundColor: "#FAF8F4",
  },
  labelCell: {
    color: COLORS.ink,
    fontFamily: "Helvetica-Bold",
  },
  note: {
    color: COLORS.muted,
    fontSize: 6.5,
    lineHeight: 1.35,
  },
  twoCol: {
    display: "flex",
    flexDirection: "row",
    gap: 10,
  },
  half: {
    flex: 1,
  },
  evidenceCard: {
    backgroundColor: COLORS.bone,
    borderColor: COLORS.line,
    borderRadius: 3,
    borderWidth: 0.6,
    flex: 1,
    padding: 11,
  },
  evidenceTitle: {
    color: COLORS.cedar,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    marginBottom: 5,
  },
  dataItem: {
    borderBottomColor: COLORS.line,
    borderBottomWidth: 0.5,
    paddingVertical: 9,
  },
  dataItemTitle: {
    color: COLORS.forest,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    marginBottom: 3,
  },
})

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function PageChrome({
  input,
  page,
  brand,
  primaryColor,
}: {
  input: RevenueBriefInput
  page: number
  brand: RevenueBriefBrandTheme | null
  primaryColor: string
}) {
  const partnerLeads = brand && brand.coBrandingMode !== "revfactor_led"
  const footerText =
    brand?.footerText ||
    (partnerLeads
      ? `${brand.name} · Revenue strategy powered by RevFactor`
      : "RevFactor · Short-term rental revenue management")

  return (
    <>
      <View style={styles.header} fixed>
        {partnerLeads && brand.logoDataUrl ? (
          // @react-pdf/renderer Image does not support the HTML alt attribute.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={brand.logoDataUrl} style={styles.headerLogo} />
        ) : (
          <Text style={[styles.headerBrand, { color: primaryColor }]}>
            revfactor
          </Text>
        )}
        <Text style={styles.headerTitle}>
          Client Revenue Opportunity Brief · {input.propertyName}
        </Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>{footerText}</Text>
        <Text>Page {page}</Text>
      </View>
    </>
  )
}

function Table({
  headers,
  rows,
  widths,
  headerColor = COLORS.moss,
}: {
  headers: string[]
  rows: string[][]
  widths: string[]
  headerColor?: string
}) {
  return (
    <View style={styles.table}>
      <View style={styles.row} fixed>
        {headers.map((header, index) => (
          <Text
            key={header}
            style={[
              styles.headerCell,
              { backgroundColor: headerColor, width: widths[index] },
            ]}
          >
            {header}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={`${rowIndex}-${row[0]}`} style={styles.row} wrap={false}>
          {row.map((cell, cellIndex) => (
            <Text
              key={`${cellIndex}-${cell}`}
              style={[
                styles.cell,
                rowIndex % 2 === 1 ? styles.altCell : {},
                cellIndex === 0 ? styles.labelCell : {},
                { width: widths[cellIndex] },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

function RevenueBriefDocument({
  input,
  brand,
}: {
  input: RevenueBriefInput
  brand: RevenueBriefBrandTheme | null
}) {
  const primaryColor = brand?.primaryColor || COLORS.forest
  const secondaryColor = brand?.secondaryColor || COLORS.moss
  const accentColor = brand?.accentColor || COLORS.cedar
  const projection = input.listingStage === "new" ? input.projection : null
  const metrics = projection
    ? [
        [
          formatMoney(projection.base.revenue, projection.currency),
          "Base annual revenue",
        ],
        [formatMoney(projection.base.adr, projection.currency), "Base ADR"],
        [input.metrics.layout, "Layout"],
        [input.metrics.guests, "Guest capacity"],
      ]
    : [
        [input.metrics.rating, "Airbnb rating"],
        [input.metrics.reviews, "Reviews"],
        [input.metrics.layout, "Layout"],
        [input.metrics.guests, "Guest capacity"],
      ]

  const partnerLeads = brand && brand.coBrandingMode !== "revfactor_led"
  const coverBrandLine = brand
    ? brand.coBrandingMode === "partner_led"
      ? "Revenue strategy powered by RevFactor"
      : brand.coBrandingMode === "co_branded"
        ? "In partnership with RevFactor"
        : `Prepared with ${brand.name}`
    : null

  return (
    <Document
      author="RevFactor"
      subject={`Revenue opportunity assessment for ${input.propertyName}`}
      title={`RevFactor Client Revenue Opportunity Brief - ${input.propertyName}`}
    >
      <Page
        size="LETTER"
        style={[styles.page, styles.cover, { backgroundColor: primaryColor }]}
      >
        <View style={[styles.coverFrame, { borderColor: secondaryColor }]}>
          {partnerLeads && brand?.logoDataUrl ? (
            // @react-pdf/renderer Image does not support the HTML alt attribute.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={brand.logoDataUrl} style={styles.coverLogo} />
          ) : (
            <Text style={styles.coverBrand}>revfactor</Text>
          )}
          {coverBrandLine && (
            <Text style={styles.coverBrandLine}>{coverBrandLine}</Text>
          )}
          <Text
            style={[
              styles.coverEyebrow,
              { color: brand?.secondaryColor || COLORS.sand },
            ]}
          >
            Client Revenue Opportunity Brief
          </Text>
          <Text style={styles.coverTitle}>{input.propertyName}</Text>
          <Text style={styles.coverLocation}>{input.locationLabel}</Text>
          <Text style={styles.coverPrepared}>
            Prepared for {input.preparedFor}
          </Text>
          {input.photoDataUrl ? (
            // @react-pdf/renderer Image does not support the HTML alt attribute.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={input.photoDataUrl} style={styles.coverImage} />
          ) : (
            <View
              style={[
                styles.coverImageFallback,
                { backgroundColor: secondaryColor },
              ]}
            >
              <View style={styles.coverRingLarge} />
              <View
                style={[styles.coverRingSmall, { borderColor: accentColor }]}
              />
              <Text style={styles.coverProperty}>{input.propertyName}</Text>
            </View>
          )}
          <Text style={styles.coverPurpose}>
            {projection
              ? "A market-informed pre-launch review of comparable performance, demand context, revenue scenarios, and launch strategy."
              : "A concise review of listing strength, demand drivers, revenue-management opportunity, and relevant RevFactor-managed benchmark performance."}
          </Text>
        </View>
        <Text style={styles.coverFooter}>
          {brand
            ? `${brand.name} · ${coverBrandLine || "Prepared with RevFactor"}`
            : "Prepared by RevFactor for client review"}
        </Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome
          input={input}
          page={2}
          brand={brand}
          primaryColor={primaryColor}
        />
        <Text style={[styles.eyebrow, { color: accentColor }]}>
          The opportunity
        </Text>
        <Text style={[styles.title, { color: primaryColor }]}>
          Executive summary
        </Text>
        <Text style={styles.intro}>{input.executiveSummary}</Text>
        <View style={styles.metricRow}>
          {metrics.map(([value, label]) => (
            <View key={label} style={styles.metricCard}>
              <Text style={[styles.metricValue, { color: accentColor }]}>
                {value}
              </Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.callout, { borderLeftColor: accentColor }]}>
          <Text style={[styles.calloutTitle, { color: accentColor }]}>
            Revenue opportunity
          </Text>
          <Text style={styles.calloutBody}>{input.bottomLine}</Text>
        </View>
        <Table
          headers={["Area reviewed", "Current read", "RevFactor angle"]}
          rows={[
            [
              "Listing quality",
              input.strengths,
              "Protect premium positioning instead of discounting unnecessarily.",
            ],
            [
              "Demand drivers",
              input.demandDrivers.map((driver) => driver.name).join(", "),
              "Build the calendar around compression dates and high-intent demand windows.",
            ],
            [
              "Revenue-management risk",
              "Strong listings can still sell peak or far-out dates too cheaply.",
              "Use pricing, stay, gap, and event rules to hold value where demand is strongest.",
            ],
          ]}
          widths={["22%", "39%", "39%"]}
          headerColor={secondaryColor}
        />
        <View
          style={[
            styles.callout,
            styles.calloutMoss,
            { backgroundColor: COLORS.bone, borderLeftColor: secondaryColor },
          ]}
        >
          <Text style={[styles.calloutTitle, { color: secondaryColor }]}>
            What this means for your listing
          </Text>
          <Text style={styles.calloutBody}>{input.ownerTakeaway}</Text>
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome
          input={input}
          page={3}
          brand={brand}
          primaryColor={primaryColor}
        />
        <Text style={[styles.eyebrow, { color: accentColor }]}>
          Property and market context
        </Text>
        <Text style={[styles.title, { color: primaryColor }]}>
          Property snapshot
        </Text>
        <Table
          headers={["Category", "Details"]}
          rows={[
            ["Listing reviewed", input.propertyName],
            ["Address", input.propertyAddress],
            ["Airbnb specs", input.listingDetails],
            ["Host / trust signals", input.hostSignals],
            ["Current positioning", input.currentPositioning],
            ["Strengths", input.strengths],
            ["Visible constraints", input.visibleConstraints],
          ]}
          widths={["25%", "75%"]}
          headerColor={secondaryColor}
        />
        <Text style={[styles.sectionTitle, { color: primaryColor }]}>
          Demand-driver map
        </Text>
        <Table
          headers={["Demand driver", "Est. distance", "Why it matters"]}
          rows={input.demandDrivers.map((driver) => [
            driver.name,
            driver.distance,
            driver.why,
          ])}
          widths={["29%", "18%", "53%"]}
          headerColor={secondaryColor}
        />
        <Text style={styles.note}>{input.distanceNote}</Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome
          input={input}
          page={4}
          brand={brand}
          primaryColor={primaryColor}
        />
        <Text style={[styles.eyebrow, { color: accentColor }]}>
          How RevFactor would work the calendar
        </Text>
        <Text style={[styles.title, { color: primaryColor }]}>
          Revenue-management opportunity
        </Text>
        <Text style={styles.intro}>
          For a high-quality{" "}
          {input.listingStage === "existing" ? "existing" : "new"} listing,
          RevFactor should focus on the calendar decisions that change rate,
          occupancy, and booking quality.
        </Text>
        <Table
          headers={[
            "Revenue lever",
            "What RevFactor would review",
            "Owner benefit",
          ]}
          rows={input.revenueLevers.map((lever) => [
            lever.name,
            lever.review,
            lever.benefit,
          ])}
          widths={["24%", "46%", "30%"]}
          headerColor={secondaryColor}
        />
        <Text style={[styles.sectionTitle, { color: primaryColor }]}>
          First 30 days
        </Text>
        <Table
          headers={["Timing", "Focus"]}
          rows={input.firstMonth.map((step) => [step.label, step.focus])}
          widths={["22%", "78%"]}
          headerColor={secondaryColor}
        />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome
          input={input}
          page={5}
          brand={brand}
          primaryColor={primaryColor}
        />
        <Text style={[styles.eyebrow, { color: accentColor }]}>
          Evidence, with an explicit boundary
        </Text>
        {projection ? (
          <>
            <Text style={[styles.title, { color: primaryColor }]}>
              Pre-launch revenue projection
            </Text>
            <Text style={styles.intro}>
              AirROI analyzed {projection.comparableCount} nearby comparable
              listings within {projection.radiusMiles} miles. These scenarios
              are market-informed planning ranges, not guaranteed property
              performance.
            </Text>
            <Table
              headers={[
                "Scenario",
                "Annual revenue",
                "ADR",
                "Occupancy",
                "Interpretation",
              ]}
              rows={[
                [
                  "Conservative (P25)",
                  formatMoney(
                    projection.conservative.revenue,
                    projection.currency
                  ),
                  formatMoney(projection.conservative.adr, projection.currency),
                  formatPercent(projection.conservative.occupancy),
                  "Lower-quartile market outcome and cautious launch baseline.",
                ],
                [
                  "Base (P50)",
                  formatMoney(projection.base.revenue, projection.currency),
                  formatMoney(projection.base.adr, projection.currency),
                  formatPercent(projection.base.occupancy),
                  "Median market outcome used for launch planning.",
                ],
                [
                  "Strong execution (P75)",
                  formatMoney(projection.strong.revenue, projection.currency),
                  formatMoney(projection.strong.adr, projection.currency),
                  formatPercent(projection.strong.occupancy),
                  "Upper-quartile outcome requiring strong execution and guest response.",
                ],
              ]}
              widths={["20%", "16%", "13%", "13%", "38%"]}
              headerColor={secondaryColor}
            />
            <View
              style={[
                styles.callout,
                { borderLeftColor: accentColor, marginTop: 10 },
              ]}
            >
              <Text style={[styles.calloutTitle, { color: accentColor }]}>
                How to use the range
              </Text>
              <Text style={styles.calloutBody}>
                Underwrite commitments against the conservative scenario, plan
                operations around the base case, and treat strong execution as
                earned upside. Launch pricing, review velocity, calendar
                availability, amenities, and local restrictions can materially
                change the outcome.
              </Text>
            </View>
            <Text style={[styles.sectionTitle, { color: primaryColor }]}>
              Selected comparable listings
            </Text>
            <Table
              headers={[
                "Comparable",
                "Bedrooms",
                "Annual revenue",
                "ADR",
                "Occupancy",
              ]}
              rows={projection.comparables.map((comparable, index) => [
                comparable.name || `Comparable ${index + 1}`,
                comparable.bedrooms == null ? "—" : String(comparable.bedrooms),
                comparable.revenue == null
                  ? "—"
                  : formatMoney(comparable.revenue, projection.currency),
                comparable.adr == null
                  ? "—"
                  : formatMoney(comparable.adr, projection.currency),
                comparable.occupancy == null
                  ? "—"
                  : formatPercent(comparable.occupancy),
              ])}
              widths={["39%", "13%", "18%", "14%", "16%"]}
              headerColor={secondaryColor}
            />
            <Text style={styles.note}>
              Source: AirROI market estimate retrieved{" "}
              {new Date(projection.retrievedAt).toLocaleDateString("en-US")}.
              Comparable selection and public-market inputs should be refreshed
              before an owner signs a management agreement.
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: primaryColor }]}>
              Revenue lift from RevFactor-managed benchmarks
            </Text>
            <Text style={styles.intro}>
              These anonymized examples show performance during the
              RevFactor-managed months analyzed. Lift compares actual
              managed-period rental revenue with estimated market-level revenue
              using market RevPAR. It is not a lifetime-since-launch measure or
              a guarantee.
            </Text>
            <View style={[styles.callout, { borderLeftColor: accentColor }]}>
              <Text style={[styles.calloutTitle, { color: accentColor }]}>
                How to interpret this benchmark
              </Text>
              <Text style={styles.calloutBody}>
                Managed months are the months of RevFactor performance data in
                the benchmark period. Revenue lift is actual rental revenue
                minus estimated market-level revenue for the same available
                nights. A same-property before-and-after view can be added
                separately when available.
              </Text>
            </View>
            <Table
              headers={[
                "Comparable property profile",
                "Managed months",
                "Managed revenue",
                "Market-level revenue",
                "Estimated lift",
                "Monthly lift",
              ]}
              rows={input.benchmarks.map((benchmark) => [
                benchmark.profile,
                benchmark.managedMonths,
                benchmark.managedRevenue,
                benchmark.marketRevenue,
                benchmark.lift,
                benchmark.monthlyLift,
              ])}
              widths={["29%", "11%", "15%", "17%", "13%", "15%"]}
              headerColor={secondaryColor}
            />
            <Text style={styles.note}>
              Basis note: market-level revenue is estimated from market RevPAR
              for the same managed-month window. RevPAR blends both rate and
              occupancy; owner-specific upside still requires property history.
            </Text>
            <View style={[styles.twoCol, { marginTop: 13 }]}>
              <View style={styles.evidenceCard}>
                <Text style={[styles.evidenceTitle, { color: accentColor }]}>
                  What the benchmark supports
                </Text>
                <Text>{input.benchmarkSummary}</Text>
              </View>
              <View style={styles.evidenceCard}>
                <Text style={[styles.evidenceTitle, { color: accentColor }]}>
                  Important boundary
                </Text>
                <Text>
                  This is a managed-period benchmark, not a guaranteed forecast
                  for {input.propertyName}.
                </Text>
              </View>
            </View>
          </>
        )}
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome
          input={input}
          page={6}
          brand={brand}
          primaryColor={primaryColor}
        />
        <Text style={[styles.eyebrow, { color: accentColor }]}>
          From fit assessment to final recommendation
        </Text>
        <Text style={[styles.title, { color: primaryColor }]}>
          Why{" "}
          {input.listingStage === "existing"
            ? "real listing history"
            : "a conservative launch baseline"}{" "}
          matters
        </Text>
        <Text style={styles.intro}>
          {input.listingStage === "existing"
            ? `${input.propertyName} is already live, so the strongest recommendation should use its actual history rather than generic market averages alone.`
            : `${input.propertyName} is a new listing, so the first recommendation should combine public comps with conservative launch and review-ramp assumptions.`}
        </Text>
        <Table
          headers={["Area", "Existing listing", "New listing"]}
          rows={[
            [
              "Baseline",
              "Real revenue, ADR, occupancy, reviews, booking window, and pacing.",
              "Comp set, launch assumptions, and a conservative ramp curve.",
            ],
            [
              "Main question",
              "Are we underpriced, mis-paced, or missing peak-event value?",
              "What launch price and promotion strategy earns reviews without sacrificing too much ADR?",
            ],
            [
              "Best proof",
              "Current calendar, 12-month history, and comparable managed accounts.",
              "Public comps, comparable managed accounts, and demand-driver map.",
            ],
            [
              "First 30 days",
              "Tune stay rules, gaps, events, base/min/max, and discounts.",
              "Set launch pricing, promotions, review ramp, and the first event calendar.",
            ],
          ]}
          widths={["19%", "40.5%", "40.5%"]}
          headerColor={secondaryColor}
        />
        <Text style={[styles.sectionTitle, { color: primaryColor }]}>
          Data needed for the final recommendation
        </Text>
        {(projection
          ? [
              [
                "Final property specification",
                "Plans, bed configuration, guest capacity, amenity scope, and accessibility details.",
              ],
              [
                "Launch readiness",
                "Photography, listing content, opening date, promotions, and review-ramp plan.",
              ],
              [
                "Regulatory and operating plan",
                "Permit status, parking, turnover capacity, fees, owner use, and operating costs.",
              ],
              [
                "Owner goals and constraints",
                "Cash-flow priorities, target guest, risk tolerance, and management expectations.",
              ],
            ]
          : [
              [
                "Performance history",
                "Last 12 months of revenue, ADR, occupancy, and monthly seasonality.",
              ],
              [
                "Current calendar rules",
                "Forward pricing, minimum nights, discounts, and blocked or owner-use dates.",
              ],
              [
                "Booking behavior",
                "Lead time, channel mix, length of stay, cancellations, and future pacing.",
              ],
              [
                "Owner goals and constraints",
                "Cash-flow, occupancy, turnover, ADR, permit, and operating priorities.",
              ],
            ]
        ).map(([title, body]) => (
          <View key={title} style={styles.dataItem}>
            <Text style={[styles.dataItemTitle, { color: primaryColor }]}>
              {title}
            </Text>
            <Text>{body}</Text>
          </View>
        ))}
        <View
          style={[
            styles.callout,
            styles.calloutMoss,
            {
              backgroundColor: COLORS.bone,
              borderLeftColor: secondaryColor,
              marginTop: 16,
            },
          ]}
        >
          <Text style={[styles.calloutTitle, { color: secondaryColor }]}>
            Important note
          </Text>
          <Text style={styles.calloutBody}>
            {projection
              ? `This brief is a market-informed fit assessment based on supplied property information and AirROI comparable data. It is not guaranteed income. ${input.finalDataRequest}`
              : `This brief is a fit assessment based on supplied listing information and anonymized RevFactor benchmark examples. It is not a guaranteed revenue projection. ${input.finalDataRequest}`}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderRevenueBriefPdf(
  input: RevenueBriefInput,
  brand: RevenueBriefBrandTheme | null = null
): Promise<Buffer> {
  return renderToBuffer(<RevenueBriefDocument input={input} brand={brand} />)
}
