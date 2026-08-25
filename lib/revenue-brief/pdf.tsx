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
    color: COLORS.forest,
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

function PageChrome({ input, page }: { input: RevenueBriefInput; page: number }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text style={styles.headerBrand}>revfactor</Text>
        <Text style={styles.headerTitle}>
          Client Revenue Opportunity Brief · {input.propertyName}
        </Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>RevFactor · Short-term rental revenue management</Text>
        <Text>Page {page}</Text>
      </View>
    </>
  )
}

function Table({
  headers,
  rows,
  widths,
}: {
  headers: string[]
  rows: string[][]
  widths: string[]
}) {
  return (
    <View style={styles.table}>
      <View style={styles.row} fixed>
        {headers.map((header, index) => (
          <Text key={header} style={[styles.headerCell, { width: widths[index] }]}>
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

function RevenueBriefDocument({ input }: { input: RevenueBriefInput }) {
  const metrics = [
    [input.metrics.rating, "Airbnb rating"],
    [input.metrics.reviews, "Reviews"],
    [input.metrics.layout, "Layout"],
    [input.metrics.guests, "Guest capacity"],
  ]

  return (
    <Document
      author="RevFactor"
      subject={`Revenue opportunity assessment for ${input.propertyName}`}
      title={`RevFactor Client Revenue Opportunity Brief - ${input.propertyName}`}
    >
      <Page size="LETTER" style={[styles.page, styles.cover]}>
        <View style={styles.coverFrame}>
          <Text style={styles.coverBrand}>revfactor</Text>
          <Text style={styles.coverEyebrow}>Client Revenue Opportunity Brief</Text>
          <Text style={styles.coverTitle}>{input.propertyName}</Text>
          <Text style={styles.coverLocation}>{input.locationLabel}</Text>
          <Text style={styles.coverPrepared}>Prepared for {input.preparedFor}</Text>
          {input.photoDataUrl ? (
            // @react-pdf/renderer Image does not support the HTML alt attribute.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={input.photoDataUrl} style={styles.coverImage} />
          ) : (
            <View style={styles.coverImageFallback}>
              <View style={styles.coverRingLarge} />
              <View style={styles.coverRingSmall} />
              <Text style={styles.coverProperty}>{input.propertyName}</Text>
            </View>
          )}
          <Text style={styles.coverPurpose}>
            A concise review of listing strength, demand drivers, revenue-management opportunity,
            and relevant RevFactor-managed benchmark performance.
          </Text>
        </View>
        <Text style={styles.coverFooter}>Prepared by RevFactor for client review</Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome input={input} page={2} />
        <Text style={styles.eyebrow}>The opportunity</Text>
        <Text style={styles.title}>Executive summary</Text>
        <Text style={styles.intro}>{input.executiveSummary}</Text>
        <View style={styles.metricRow}>
          {metrics.map(([value, label]) => (
            <View key={label} style={styles.metricCard}>
              <Text style={styles.metricValue}>{value}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>Revenue opportunity</Text>
          <Text style={styles.calloutBody}>{input.bottomLine}</Text>
        </View>
        <Table
          headers={["Area reviewed", "Current read", "RevFactor angle"]}
          rows={[
            ["Listing quality", input.strengths, "Protect premium positioning instead of discounting unnecessarily."],
            ["Demand drivers", input.demandDrivers.map((driver) => driver.name).join(", "), "Build the calendar around compression dates and high-intent demand windows."],
            ["Revenue-management risk", "Strong listings can still sell peak or far-out dates too cheaply.", "Use pricing, stay, gap, and event rules to hold value where demand is strongest."],
          ]}
          widths={["22%", "39%", "39%"]}
        />
        <View style={[styles.callout, styles.calloutMoss]}>
          <Text style={[styles.calloutTitle, { color: COLORS.moss }]}>What this means for your listing</Text>
          <Text style={styles.calloutBody}>{input.ownerTakeaway}</Text>
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome input={input} page={3} />
        <Text style={styles.eyebrow}>Property and market context</Text>
        <Text style={styles.title}>Property snapshot</Text>
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
        />
        <Text style={styles.sectionTitle}>Demand-driver map</Text>
        <Table
          headers={["Demand driver", "Est. distance", "Why it matters"]}
          rows={input.demandDrivers.map((driver) => [driver.name, driver.distance, driver.why])}
          widths={["29%", "18%", "53%"]}
        />
        <Text style={styles.note}>{input.distanceNote}</Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome input={input} page={4} />
        <Text style={styles.eyebrow}>How RevFactor would work the calendar</Text>
        <Text style={styles.title}>Revenue-management opportunity</Text>
        <Text style={styles.intro}>
          For a high-quality {input.listingStage === "existing" ? "existing" : "new"} listing,
          RevFactor should focus on the calendar decisions that change rate, occupancy, and booking quality.
        </Text>
        <Table
          headers={["Revenue lever", "What RevFactor would review", "Owner benefit"]}
          rows={input.revenueLevers.map((lever) => [lever.name, lever.review, lever.benefit])}
          widths={["24%", "46%", "30%"]}
        />
        <Text style={styles.sectionTitle}>First 30 days</Text>
        <Table
          headers={["Timing", "Focus"]}
          rows={input.firstMonth.map((step) => [step.label, step.focus])}
          widths={["22%", "78%"]}
        />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome input={input} page={5} />
        <Text style={styles.eyebrow}>Evidence, with an explicit boundary</Text>
        <Text style={styles.title}>Revenue lift from RevFactor-managed benchmarks</Text>
        <Text style={styles.intro}>
          These anonymized examples show performance during the RevFactor-managed months analyzed.
          Lift compares actual managed-period rental revenue with estimated market-level revenue using
          market RevPAR. It is not a lifetime-since-launch measure or a guarantee.
        </Text>
        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>How to interpret this benchmark</Text>
          <Text style={styles.calloutBody}>
            Managed months are the months of RevFactor performance data in the benchmark period.
            Revenue lift is actual rental revenue minus estimated market-level revenue for the same
            available nights. A same-property before-and-after view can be added separately when available.
          </Text>
        </View>
        <Table
          headers={["Comparable property profile", "Managed months", "Managed revenue", "Market-level revenue", "Estimated lift", "Monthly lift"]}
          rows={input.benchmarks.map((benchmark) => [
            benchmark.profile,
            benchmark.managedMonths,
            benchmark.managedRevenue,
            benchmark.marketRevenue,
            benchmark.lift,
            benchmark.monthlyLift,
          ])}
          widths={["29%", "11%", "15%", "17%", "13%", "15%"]}
        />
        <Text style={styles.note}>
          Basis note: market-level revenue is estimated from market RevPAR for the same managed-month
          window. RevPAR blends both rate and occupancy; owner-specific upside still requires property history.
        </Text>
        <View style={[styles.twoCol, { marginTop: 13 }]}>
          <View style={styles.evidenceCard}>
            <Text style={styles.evidenceTitle}>What the benchmark supports</Text>
            <Text>{input.benchmarkSummary}</Text>
          </View>
          <View style={styles.evidenceCard}>
            <Text style={styles.evidenceTitle}>Important boundary</Text>
            <Text>
              This does not claim that each comparable earned its lift since original Airbnb launch.
              It is a managed-period benchmark, not a guaranteed forecast for {input.propertyName}.
            </Text>
          </View>
        </View>
        <View style={[styles.callout, styles.calloutMoss, { marginTop: 13 }]}>
          <Text style={[styles.calloutTitle, { color: COLORS.moss }]}>
            What this means for {input.propertyName}
          </Text>
          <Text style={styles.calloutBody}>
            Once {input.preparedFor} shares current performance history and calendar access,
            RevFactor can quantify the gap between the current baseline and a managed-calendar target.
          </Text>
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome input={input} page={6} />
        <Text style={styles.eyebrow}>From fit assessment to final recommendation</Text>
        <Text style={styles.title}>
          Why {input.listingStage === "existing" ? "real listing history" : "a conservative launch baseline"} matters
        </Text>
        <Text style={styles.intro}>
          {input.listingStage === "existing"
            ? `${input.propertyName} is already live, so the strongest recommendation should use its actual history rather than generic market averages alone.`
            : `${input.propertyName} is a new listing, so the first recommendation should combine public comps with conservative launch and review-ramp assumptions.`}
        </Text>
        <Table
          headers={["Area", "Existing listing", "New listing"]}
          rows={[
            ["Baseline", "Real revenue, ADR, occupancy, reviews, booking window, and pacing.", "Comp set, launch assumptions, and a conservative ramp curve."],
            ["Main question", "Are we underpriced, mis-paced, or missing peak-event value?", "What launch price and promotion strategy earns reviews without sacrificing too much ADR?"],
            ["Best proof", "Current calendar, 12-month history, and comparable managed accounts.", "Public comps, comparable managed accounts, and demand-driver map."],
            ["First 30 days", "Tune stay rules, gaps, events, base/min/max, and discounts.", "Set launch pricing, promotions, review ramp, and the first event calendar."],
          ]}
          widths={["19%", "40.5%", "40.5%"]}
        />
        <Text style={styles.sectionTitle}>Data needed for the final recommendation</Text>
        {[
          ["Performance history", "Last 12 months of revenue, ADR, occupancy, and monthly seasonality."],
          ["Current calendar rules", "Forward pricing, minimum nights, discounts, and blocked or owner-use dates."],
          ["Booking behavior", "Lead time, channel mix, length of stay, cancellations, and future pacing."],
          ["Owner goals and constraints", "Cash-flow, occupancy, turnover, ADR, permit, and operating priorities."],
        ].map(([title, body]) => (
          <View key={title} style={styles.dataItem}>
            <Text style={styles.dataItemTitle}>{title}</Text>
            <Text>{body}</Text>
          </View>
        ))}
        <View style={[styles.callout, styles.calloutMoss, { marginTop: 16 }]}>
          <Text style={[styles.calloutTitle, { color: COLORS.moss }]}>Important note</Text>
          <Text style={styles.calloutBody}>
            This brief is a fit assessment based on supplied listing information and anonymized RevFactor
            benchmark examples. It is not a guaranteed revenue projection. {input.finalDataRequest}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderRevenueBriefPdf(input: RevenueBriefInput): Promise<Buffer> {
  return renderToBuffer(<RevenueBriefDocument input={input} />)
}
