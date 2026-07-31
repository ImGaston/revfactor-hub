// Server-only ExcelJS renderer for the Grant-style client reservations report.
// All aggregates arrive precomputed in the GrantStyleReportModel — Excel is a
// presentation layer here. The only formulas written are totals, absolute
// change and percentage change, always with a cached `result`.

import ExcelJS from "exceljs"
import type { ReservationExportRow } from "@/lib/reservations"
import {
  BOOKING_WINDOW_SEGMENTS,
  EPOCH_SENTINEL,
  formatPeriodLabel,
  monthLabel,
  type ExportDateField,
  type SegmentStats,
} from "@/lib/reservations-export"
import type {
  GrantStyleReportModel,
  ListingComparisonRow,
} from "@/lib/reservations-report-model"
import type { RenderedChart } from "@/lib/reservations-chart.server"

// Grant visual language
const GREEN_DARK = "FF13342D" // current-period bands
const BLUE_DARK = "FF073763" // comparison bands / KPI values
const BLUE_HEADER = "FF0B5394" // table headers (blue tables)
const TOTAL_FILL = "FFCCCCCC"
const ZEBRA_FILL = "FFF2F2F2"
const KPI_LABEL = "FF666666"
const WHITE = "FFFFFFFF"
const POS_GREEN = "FF38761D"
const NEG_RED = "FFCC0000"
const OCC_MAX = "FFC9DAF8"

const PCT_FMT = "0%"
const PCT1_FMT = "0.0%"
const DATE_FMT = "m/d/yyyy"

type Fill = ExcelJS.FillPattern

function solid(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } }
}

function arial(overrides: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: "Arial", size: 10, ...overrides }
}

const DATE_FIELD_LABELS: Record<ExportDateField, string> = {
  check_in: "Check-in",
  booked_date: "Booked Date",
}

export type GrantWorkbookInput = {
  clientName: string
  dateField: ExportDateField
  model: GrantStyleReportModel
  currentRows: ReservationExportRow[]
  previousRows: ReservationExportRow[]
  lastYearRows: ReservationExportRow[]
  charts: { revenue: RenderedChart; reservations: RenderedChart } | null
}

function excelDate(iso: string | null): Date | null {
  if (!iso || iso === EPOCH_SENTINEL) return null
  return new Date(`${iso}T00:00:00Z`)
}

function rowAdr(r: ReservationExportRow): number | null {
  if (r.rental_revenue == null || !r.number_of_days) return null
  return r.rental_revenue / r.number_of_days
}

function segmentCellText(seg: SegmentStats): string {
  const pct = seg.revenuePct != null ? `${Math.round(seg.revenuePct * 100)}%` : "—"
  return `${seg.count} (${pct})`
}

// ---------------------------------------------------------------------------
// Detail sheets (Reservations / Previous Period / Last Year)
// ---------------------------------------------------------------------------

const DETAIL_COLUMNS: { header: string; width: number; numFmt?: string }[] = [
  { header: "Listing Name", width: 42 },
  { header: "Check-in", width: 12, numFmt: DATE_FMT },
  { header: "Check-out", width: 12, numFmt: DATE_FMT },
  { header: "Booked Date", width: 12, numFmt: DATE_FMT },
  { header: "Nights", width: 8 },
  { header: "Booking Window (Days)", width: 20 },
  { header: "ADR", width: 12 },
  { header: "Rental Revenue", width: 15 },
  { header: "Cleaning Fees", width: 14 },
  { header: "Total Revenue", width: 14 },
  { header: "Currency", width: 10 },
  { header: "Channel", width: 14 },
  { header: "Reservation ID", width: 16 },
  { header: "Listing ID", width: 16 },
  { header: "PMS", width: 12 },
  { header: "Confirmation Code", width: 18 },
]

function addDetailSheet(
  wb: ExcelJS.Workbook,
  name: string,
  tableName: string,
  rows: ReservationExportRow[],
  moneyFmt: string,
  hidden: boolean
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] })
  if (hidden) ws.state = "hidden"
  ws.columns = DETAIL_COLUMNS.map((c) => ({ width: c.width }))

  ws.addTable({
    name: tableName,
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleLight1", showRowStripes: true },
    columns: DETAIL_COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.map((r) => [
      r.listing_name,
      excelDate(r.check_in),
      excelDate(r.check_out),
      excelDate(r.booked_date),
      r.number_of_days,
      r.booking_window_days,
      rowAdr(r),
      r.rental_revenue,
      r.cleaning_fees,
      r.total_cost,
      r.currency,
      r.booking_channel,
      r.reservation_id,
      r.listing_id,
      r.pms,
      r.channel_confirmation_code,
    ]),
  })

  DETAIL_COLUMNS.forEach((c, idx) => {
    const col = ws.getColumn(idx + 1)
    col.font = arial()
    if (c.numFmt) col.numFmt = c.numFmt
  })
  for (const moneyCol of [7, 8, 9, 10]) ws.getColumn(moneyCol).numFmt = `${moneyFmt}.00`
  ws.getRow(1).font = arial({ bold: true })
}

// ---------------------------------------------------------------------------
// Summary building blocks
// ---------------------------------------------------------------------------

const BAND_SPAN = 13 // bands span columns B..N

class SheetCursor {
  constructor(
    public ws: ExcelJS.Worksheet,
    public row: number
  ) {}

  next(count = 1): number {
    const r = this.row
    this.row += count
    return r
  }
}

function writeBand(cur: SheetCursor, text: string, fillArgb: string) {
  const r = cur.next()
  const row = cur.ws.getRow(r)
  row.height = 22
  for (let c = 2; c < 2 + BAND_SPAN; c++) {
    row.getCell(c).fill = solid(fillArgb)
  }
  cur.ws.mergeCells(r, 2, r, 2 + BAND_SPAN - 1)
  const cell = row.getCell(2)
  cell.value = text
  cell.font = arial({ bold: true, size: 12, color: { argb: WHITE } })
  cell.alignment = { vertical: "middle" }
}

function writeNote(cur: SheetCursor, text: string) {
  const r = cur.next()
  const cell = cur.ws.getRow(r).getCell(3)
  cell.value = text
  cell.font = arial({ italic: true, size: 9, color: { argb: KPI_LABEL } })
}

function writeTableHeader(
  cur: SheetCursor,
  startCol: number,
  labels: string[],
  fillArgb: string
): number {
  const r = cur.next()
  const row = cur.ws.getRow(r)
  labels.forEach((label, i) => {
    const cell = row.getCell(startCol + i)
    cell.value = label
    cell.fill = solid(fillArgb)
    cell.font = arial({ bold: true, color: { argb: WHITE } })
    cell.alignment = { vertical: "middle", wrapText: true }
  })
  return r
}

type CellSpec = {
  value: ExcelJS.CellValue
  numFmt?: string
  font?: Partial<ExcelJS.Font>
  fill?: string
}

function writeRow(
  cur: SheetCursor,
  startCol: number,
  cells: CellSpec[],
  zebra?: boolean
): number {
  const r = cur.next()
  const row = cur.ws.getRow(r)
  cells.forEach((spec, i) => {
    const cell = row.getCell(startCol + i)
    if (spec.value !== null && spec.value !== undefined) cell.value = spec.value
    cell.font = arial(spec.font)
    if (spec.numFmt) cell.numFmt = spec.numFmt
    if (spec.fill) cell.fill = solid(spec.fill)
    else if (zebra) cell.fill = solid(ZEBRA_FILL)
  })
  return r
}

// ExcelJS drops a cached `result: 0` when serializing formulas, which would
// leave a formula with no cached result — so zero results are written as plain
// values instead.
function formulaOrValue(formula: string, result: number): ExcelJS.CellValue {
  return result === 0 ? 0 : { formula, result }
}

function sumFormula(col: string, first: number, last: number, result: number) {
  return formulaOrValue(`SUM(${col}${first}:${col}${last})`, result)
}

// ---------------------------------------------------------------------------
// Listing comparison tables (shared by Summary and Comparison sheets)
// ---------------------------------------------------------------------------

function writeListingComparisonTable(
  cur: SheetCursor,
  input: GrantWorkbookInput,
  kind: "revenue" | "reservations",
  moneyFmt: string
) {
  const { model } = input
  const metricLabel = kind === "revenue" ? "Rental Revenue" : "Resv. Count"
  const valueFmt = kind === "revenue" ? moneyFmt : "0"

  writeBand(
    cur,
    `${metricLabel} — Current vs Previous Period (by listing)`,
    BLUE_DARK
  )
  writeRow(cur, 3, [
    { value: "Book Dates:", font: { bold: true } },
    { value: formatPeriodLabel(model.periods.current), font: { bold: true } },
    { value: formatPeriodLabel(model.periods.previousMonthAligned) },
  ])
  writeTableHeader(
    cur,
    3,
    ["Listing", "Current", "Previous", "Absolute Change", "% Change"],
    BLUE_HEADER
  )
  const first = cur.row
  model.listingComparisons.forEach((l, i) => {
    const current = kind === "revenue" ? l.currentRevenue : l.currentReservations
    const previous = kind === "revenue" ? l.previousRevenue : l.previousReservations
    const change = kind === "revenue" ? l.revenueChange : l.reservationsChange
    const changePct =
      kind === "revenue" ? l.revenueChangePct : l.reservationsChangePct
    const r = cur.row
    const changeFont: Partial<ExcelJS.Font> =
      change > 0
        ? { color: { argb: POS_GREEN } }
        : change < 0
          ? { color: { argb: NEG_RED } }
          : {}
    writeRow(
      cur,
      3,
      [
        { value: l.listingName },
        { value: current, numFmt: valueFmt },
        { value: previous, numFmt: valueFmt },
        {
          value: formulaOrValue(`D${r}-E${r}`, change),
          numFmt: valueFmt,
          font: changeFont,
        },
        changePct == null
          ? { value: null }
          : {
              value: formulaOrValue(`(D${r}-E${r})/ABS(E${r})`, changePct),
              numFmt: PCT1_FMT,
              font: changeFont,
            },
      ],
      i % 2 === 1
    )
  })
  const last = cur.row - 1
  const totalCurrent = model.listingComparisons.reduce(
    (a, l) => a + (kind === "revenue" ? l.currentRevenue : l.currentReservations),
    0
  )
  const totalPrevious = model.listingComparisons.reduce(
    (a, l) => a + (kind === "revenue" ? l.previousRevenue : l.previousReservations),
    0
  )
  if (last >= first) {
    const r = cur.row
    const totalPct =
      totalPrevious === 0 ? null : (totalCurrent - totalPrevious) / Math.abs(totalPrevious)
    writeRow(cur, 3, [
      { value: "Total", font: { bold: true }, fill: TOTAL_FILL },
      {
        value: sumFormula("D", first, last, totalCurrent),
        numFmt: valueFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      {
        value: sumFormula("E", first, last, totalPrevious),
        numFmt: valueFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      {
        value: formulaOrValue(`D${r}-E${r}`, totalCurrent - totalPrevious),
        numFmt: valueFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      totalPct == null
        ? { value: null, fill: TOTAL_FILL }
        : {
            value: formulaOrValue(`(D${r}-E${r})/ABS(E${r})`, totalPct),
            numFmt: PCT1_FMT,
            font: { bold: true },
            fill: TOTAL_FILL,
          },
    ])
  }
  cur.next() // spacer
}

// ---------------------------------------------------------------------------
// Summary sheet
// ---------------------------------------------------------------------------

const SEGMENT_HEADERS = BOOKING_WINDOW_SEGMENTS.map((s) => `BW ${s} days`)

function addSummarySheet(wb: ExcelJS.Workbook, input: GrantWorkbookInput) {
  const { model, clientName, dateField } = input
  const mixed = model.currentKpis.currencies.length > 1
  const moneyFmt = mixed ? "#,##0" : '"$"#,##0'
  const ws = wb.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
  })
  ws.columns = [
    { width: 2 },
    { width: 8 },
    { width: 44 },
    ...Array.from({ length: 12 }, () => ({ width: 14.5 })),
  ]

  // Title band (rows 1-3)
  for (let r = 1; r <= 3; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= 1 + BAND_SPAN; c++) row.getCell(c).fill = solid(GREEN_DARK)
  }
  ws.mergeCells(2, 2, 2, 2 + BAND_SPAN - 1)
  const title = ws.getCell(2, 2)
  title.value = `${clientName} | Reservation Data`
  title.font = arial({ bold: true, size: 20, color: { argb: WHITE } })
  ws.getRow(2).height = 30

  const cur = new SheetCursor(ws, 4)
  const periodText = `Reservations booked (${DATE_FIELD_LABELS[dateField]}) ${formatPeriodLabel(model.periods.current)} · Generated as of ${model.periods.asOf}`
  writeRow(cur, 2, [{ value: null }, { value: periodText, font: { italic: true, size: 9, color: { argb: KPI_LABEL } } }])
  cur.next()

  // --- KPIs ---
  const kpiDefs: { label: string; value: number | null; numFmt?: string }[] = [
    { label: "# of Listings", value: model.currentKpis.listings },
    { label: "Rental Revenue", value: model.currentKpis.rentalRevenue, numFmt: moneyFmt },
    {
      label: "AVG Rental Revenue",
      value: model.currentKpis.avgRevenuePerReservation,
      numFmt: moneyFmt,
    },
    { label: "ADR", value: model.currentKpis.adr, numFmt: moneyFmt },
    { label: "Reservations Count", value: model.currentKpis.reservations },
    { label: "Total Nights", value: model.currentKpis.nights },
    { label: "Booking Window (median)", value: model.currentKpis.bookingWindowMedian },
    { label: "LOS (median)", value: model.currentKpis.losMedian },
  ]
  writeRow(
    cur,
    3,
    kpiDefs.map((k) => ({
      value: k.label,
      font: { bold: true, size: 9, color: { argb: KPI_LABEL } },
    }))
  )
  writeRow(
    cur,
    3,
    kpiDefs.map((k) => ({
      value: k.value,
      numFmt: k.numFmt,
      font: { bold: true, size: 14, color: { argb: BLUE_DARK } },
    }))
  )
  for (const warning of model.warnings) {
    if (warning.code.startsWith("reconciliation_")) continue
    writeNote(cur, warning.message)
  }
  cur.next()

  // --- Listing breakdown ---
  writeBand(
    cur,
    "Reservations by Listing · Booking Window (Segment) | Revenue % Contribution",
    GREEN_DARK
  )
  writeTableHeader(
    cur,
    3,
    ["Listing", "Rental Revenue", "Avg Rev. per Resv.", "ADR", "Resv. Count", "Nights", ...SEGMENT_HEADERS],
    GREEN_DARK
  )
  const listingFirst = cur.row
  model.listingBreakdown.forEach((l, i) => {
    writeRow(
      cur,
      3,
      [
        { value: l.listingName },
        { value: l.rentalRevenue, numFmt: moneyFmt },
        { value: l.avgRevenue, numFmt: moneyFmt },
        { value: l.adr, numFmt: moneyFmt },
        { value: l.reservations },
        { value: l.nights },
        ...BOOKING_WINDOW_SEGMENTS.map((s) => ({ value: segmentCellText(l.segments[s]) })),
      ],
      i % 2 === 1
    )
  })
  const listingLast = cur.row - 1
  if (listingLast >= listingFirst) {
    writeRow(cur, 3, [
      { value: "Total", font: { bold: true }, fill: TOTAL_FILL },
      {
        value: sumFormula("D", listingFirst, listingLast, model.currentKpis.rentalRevenue),
        numFmt: moneyFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      { value: model.currentKpis.avgRevenuePerReservation, numFmt: moneyFmt, font: { bold: true }, fill: TOTAL_FILL },
      { value: model.currentKpis.adr, numFmt: moneyFmt, font: { bold: true }, fill: TOTAL_FILL },
      {
        value: sumFormula("G", listingFirst, listingLast, model.currentKpis.reservations),
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      {
        value: sumFormula("H", listingFirst, listingLast, model.currentKpis.nights),
        font: { bold: true },
        fill: TOTAL_FILL,
      },
    ])
  }
  cur.next()

  // --- Channel breakdown ---
  writeBand(cur, "Reservations by Channel", GREEN_DARK)
  writeTableHeader(
    cur,
    2,
    ["Listings", "Channel", "Rental Revenue", "Avg Rev. per Resv.", "ADR", "Resv. Count", "Nights", ...SEGMENT_HEADERS],
    GREEN_DARK
  )
  const channelFirst = cur.row
  model.channelBreakdown.forEach((c, i) => {
    writeRow(
      cur,
      2,
      [
        { value: c.listings },
        { value: c.channel },
        { value: c.rentalRevenue, numFmt: moneyFmt },
        { value: c.avgRevenue, numFmt: moneyFmt },
        { value: c.adr, numFmt: moneyFmt },
        { value: c.reservations },
        { value: c.nights },
        ...BOOKING_WINDOW_SEGMENTS.map((s) => ({ value: segmentCellText(c.segments[s]) })),
      ],
      i % 2 === 1
    )
  })
  const channelLast = cur.row - 1
  if (channelLast >= channelFirst) {
    writeRow(cur, 2, [
      { value: null, fill: TOTAL_FILL },
      { value: "Total", font: { bold: true }, fill: TOTAL_FILL },
      {
        value: sumFormula("D", channelFirst, channelLast, model.currentKpis.rentalRevenue),
        numFmt: moneyFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      { value: null, fill: TOTAL_FILL },
      { value: null, fill: TOTAL_FILL },
      {
        value: sumFormula("G", channelFirst, channelLast, model.currentKpis.reservations),
        font: { bold: true },
        fill: TOTAL_FILL,
      },
      {
        value: sumFormula("H", channelFirst, channelLast, model.currentKpis.nights),
        font: { bold: true },
        fill: TOTAL_FILL,
      },
    ])
  }
  cur.next()

  // --- Charts ---
  if (input.charts) {
    writeBand(cur, "Charts", GREEN_DARK)
    cur.next()
    const rowPx = 20 // approximate default row height in px
    for (const chart of [input.charts.revenue, input.charts.reservations]) {
      const imageId = wb.addImage({ buffer: chart.png as unknown as ExcelJS.Buffer, extension: "png" })
      ws.addImage(imageId, {
        tl: { col: 2, row: cur.row - 1 },
        ext: { width: chart.width, height: chart.height },
      })
      cur.next(Math.ceil(chart.height / rowPx) + 2)
    }
  }

  // --- Monthly pickup ---
  const pickup = model.monthlyPickup
  writeBand(
    cur,
    `Monthly Revenue (Bookings from ${formatPeriodLabel(model.periods.current)})`,
    GREEN_DARK
  )
  const pickupCols = [
    "Listing",
    ...pickup.months.map(monthLabel),
    ...(pickup.hasLater ? ["Later"] : []),
    "Total",
  ]
  writeTableHeader(cur, 3, pickupCols, GREEN_DARK)
  const pickupFirst = cur.row
  pickup.rows.forEach((row, i) => {
    writeRow(
      cur,
      3,
      [
        { value: row.listingName },
        ...pickup.months.map((m) => ({
          value: row.byMonth[m] > 0 ? row.byMonth[m] : null,
          numFmt: moneyFmt,
        })),
        ...(pickup.hasLater
          ? [{ value: row.later > 0 ? row.later : null, numFmt: moneyFmt }]
          : []),
        { value: row.total, numFmt: moneyFmt, font: { bold: true } },
      ],
      i % 2 === 1
    )
  })
  const pickupLast = cur.row - 1
  if (pickupLast >= pickupFirst) {
    const colLetter = (offset: number) =>
      ws.getColumn(4 + offset).letter // first month column is D
    writeRow(cur, 3, [
      { value: "Total", font: { bold: true }, fill: TOTAL_FILL },
      ...pickup.months.map((m, i) => ({
        value: sumFormula(colLetter(i), pickupFirst, pickupLast, pickup.totalsByMonth[m]),
        numFmt: moneyFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      })),
      ...(pickup.hasLater
        ? [
            {
              value: sumFormula(
                colLetter(pickup.months.length),
                pickupFirst,
                pickupLast,
                pickup.laterTotal
              ),
              numFmt: moneyFmt,
              font: { bold: true },
              fill: TOTAL_FILL,
            },
          ]
        : []),
      {
        value: pickup.grandTotal,
        numFmt: moneyFmt,
        font: { bold: true },
        fill: TOTAL_FILL,
      },
    ])
    writeRow(cur, 3, [
      { value: "% Contribution", font: { bold: true }, fill: TOTAL_FILL },
      ...pickup.months.map((m) => ({
        value: pickup.contributionByMonth[m],
        numFmt: PCT1_FMT,
        fill: TOTAL_FILL,
      })),
      ...(pickup.hasLater
        ? [{ value: pickup.laterContribution, numFmt: PCT1_FMT, fill: TOTAL_FILL }]
        : []),
      { value: pickup.grandTotal > 0 ? 1 : null, numFmt: PCT1_FMT, fill: TOTAL_FILL },
    ])
  }
  cur.next()

  // --- Occupancy ---
  writeBand(cur, "Occupancy", GREEN_DARK)
  const occ = model.occupancy
  if (!occ) {
    writeNote(cur, "Occupancy data is not available for this report")
    cur.next()
  } else {
    writeNote(cur, `Source: ${occ.source}`)

    // Block 1: occupancy per horizon
    writeTableHeader(cur, 3, ["Listing name", ...occ.horizons.map((h) => h.label)], GREEN_DARK)
    const occFirst = cur.row
    occ.rows.forEach((row) => {
      writeRow(cur, 3, [
        { value: row.listingName },
        ...row.occupancyPct.map((v) => ({ value: v, numFmt: PCT_FMT })),
      ])
    })
    const occLast = cur.row - 1
    if (occLast >= occFirst) {
      ws.addConditionalFormatting({
        ref: `D${occFirst}:${ws.getColumn(3 + occ.horizons.length).letter}${occLast}`,
        rules: [
          {
            type: "colorScale",
            priority: 1,
            cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }],
            color: [{ argb: WHITE }, { argb: OCC_MAX }],
          },
        ],
      })
    }
    cur.next()

    // Block 2: occupancy + rental revenue
    const horizonLabelCells: CellSpec[] = [{ value: null }]
    for (const h of occ.horizons) {
      horizonLabelCells.push(
        { value: h.label, font: { bold: true } },
        { value: null }
      )
    }
    writeRow(cur, 3, horizonLabelCells)
    writeTableHeader(
      cur,
      3,
      ["Listing name", ...occ.horizons.flatMap(() => ["Occ %", "Rental Revenue"])],
      BLUE_HEADER
    )
    occ.rows.forEach((row, i) => {
      writeRow(
        cur,
        3,
        [
          { value: row.listingName },
          ...occ.horizons.flatMap((_, hIdx) => [
            { value: row.occupancyPct[hIdx], numFmt: PCT_FMT },
            { value: row.rentalRevenue[hIdx], numFmt: moneyFmt },
          ]),
        ],
        i % 2 === 1
      )
    })
    cur.next()

    // Block 3: property vs market occupancy
    writeRow(cur, 3, horizonLabelCells)
    writeTableHeader(
      cur,
      3,
      ["Listing name", ...occ.horizons.flatMap(() => ["Occ %", "Market Occ %"])],
      BLUE_HEADER
    )
    const vsFirst = cur.row
    occ.rows.forEach((row, i) => {
      writeRow(
        cur,
        3,
        [
          { value: row.listingName },
          ...occ.horizons.flatMap((_, hIdx) => [
            { value: row.occupancyPct[hIdx], numFmt: PCT_FMT },
            { value: row.marketOccupancyPct[hIdx], numFmt: PCT_FMT },
          ]),
        ],
        i % 2 === 1
      )
    })
    const vsLast = cur.row - 1
    if (vsLast >= vsFirst) {
      ws.addConditionalFormatting({
        ref: `D${vsFirst}:${ws.getColumn(3 + occ.horizons.length * 2).letter}${vsLast}`,
        rules: [
          {
            type: "colorScale",
            priority: 1,
            cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }],
            color: [{ argb: WHITE }, { argb: OCC_MAX }],
          },
        ],
      })
    }
    cur.next()
  }

  // --- Listing comparisons ---
  writeListingComparisonTable(cur, input, "revenue", moneyFmt)
  writeListingComparisonTable(cur, input, "reservations", moneyFmt)
}

// ---------------------------------------------------------------------------
// Comparison sheet (global KPIs + per-listing tables)
// ---------------------------------------------------------------------------

const KPI_COMPARISON_ROWS: {
  label: string
  value: (k: GrantStyleReportModel["currentKpis"]) => number | null
  money?: boolean
}[] = [
  { label: "# of Listings", value: (k) => k.listings },
  { label: "Reservations Count", value: (k) => k.reservations },
  { label: "Total Nights", value: (k) => k.nights },
  { label: "Rental Revenue", value: (k) => k.rentalRevenue, money: true },
  { label: "AVG Rental Revenue", value: (k) => k.avgRevenuePerReservation, money: true },
  { label: "ADR", value: (k) => k.adr, money: true },
  { label: "Booking Window (median)", value: (k) => k.bookingWindowMedian },
  { label: "LOS (median)", value: (k) => k.losMedian },
]

function addComparisonSheet(wb: ExcelJS.Workbook, input: GrantWorkbookInput) {
  const { model } = input
  const mixed = model.currentKpis.currencies.length > 1
  const moneyFmt = mixed ? "#,##0" : '"$"#,##0'
  const ws = wb.addWorksheet("Comparison", {
    views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
  })
  ws.columns = [
    { width: 2 },
    { width: 8 },
    { width: 44 },
    ...Array.from({ length: 8 }, () => ({ width: 16 })),
  ]

  const cur = new SheetCursor(ws, 1)
  writeBand(cur, `${input.clientName} — Period Comparison`, BLUE_DARK)
  cur.next()
  writeRow(cur, 3, [
    { value: "Current", font: { bold: true } },
    { value: formatPeriodLabel(model.periods.current) },
  ])
  writeRow(cur, 3, [
    { value: "Previous (month-aligned)", font: { bold: true } },
    { value: formatPeriodLabel(model.periods.previousMonthAligned) },
  ])
  writeRow(cur, 3, [
    { value: "Same Period Last Year", font: { bold: true } },
    { value: formatPeriodLabel(model.periods.lastYear) },
  ])
  cur.next()

  writeTableHeader(
    cur,
    3,
    ["KPI", "Current", "Previous Period", "Δ% vs Previous", "Last Year", "Δ% vs Last Year"],
    BLUE_HEADER
  )
  for (const def of KPI_COMPARISON_ROWS) {
    const current = def.value(model.currentKpis)
    const previous = def.value(model.previousKpis)
    const lastYear = def.value(model.lastYearKpis)
    const numFmt = def.money ? moneyFmt : undefined
    const prevPct =
      current == null || previous == null || previous === 0
        ? null
        : (current - previous) / Math.abs(previous)
    const lyPct =
      current == null || lastYear == null || lastYear === 0
        ? null
        : (current - lastYear) / Math.abs(lastYear)
    writeRow(cur, 3, [
      { value: def.label, font: { bold: true } },
      { value: current, numFmt },
      { value: previous, numFmt },
      prevPct == null
        ? { value: null }
        : {
            value: prevPct,
            numFmt: PCT1_FMT,
            font: { color: { argb: prevPct >= 0 ? POS_GREEN : NEG_RED } },
          },
      { value: lastYear, numFmt },
      lyPct == null
        ? { value: null }
        : {
            value: lyPct,
            numFmt: PCT1_FMT,
            font: { color: { argb: lyPct >= 0 ? POS_GREEN : NEG_RED } },
          },
    ])
  }
  cur.next()

  writeListingComparisonTable(cur, input, "revenue", moneyFmt)
  writeListingComparisonTable(cur, input, "reservations", moneyFmt)
}

// ---------------------------------------------------------------------------
// Occupancy sheet (hidden raw table) and _ChartData
// ---------------------------------------------------------------------------

function addOccupancySheet(wb: ExcelJS.Workbook, input: GrantWorkbookInput) {
  const occ = input.model.occupancy
  if (!occ) return
  const ws = wb.addWorksheet("Occupancy", { views: [{ state: "frozen", ySplit: 1 }] })
  ws.state = "hidden"
  const header = [
    "Listing Name",
    "Listing ID",
    ...occ.horizons.flatMap((h) => [
      `${h.label} Occ %`,
      `${h.label} Market Occ %`,
      `${h.label} Rental Revenue`,
    ]),
  ]
  ws.addRow(header).font = arial({ bold: true })
  ws.getColumn(1).width = 42
  ws.getColumn(2).width = 14
  for (let c = 3; c <= header.length; c++) ws.getColumn(c).width = 20
  for (const row of occ.rows) {
    ws.addRow([
      row.listingName,
      row.listingId,
      ...occ.horizons.flatMap((_, i) => [
        row.occupancyPct[i],
        row.marketOccupancyPct[i],
        row.rentalRevenue[i],
      ]),
    ]).font = arial()
  }
  occ.horizons.forEach((_, i) => {
    ws.getColumn(3 + i * 3).numFmt = PCT_FMT
    ws.getColumn(4 + i * 3).numFmt = PCT_FMT
    ws.getColumn(5 + i * 3).numFmt = '"$"#,##0'
  })
}

function addChartDataSheet(wb: ExcelJS.Workbook, input: GrantWorkbookInput) {
  const data = input.model.channelChartData
  const ws = wb.addWorksheet("_ChartData")
  ws.state = "hidden"
  ws.getColumn(1).width = 44
  for (let c = 2; c <= 1 + data.channels.length; c++) ws.getColumn(c).width = 18

  for (const [label, matrix] of [
    ["Rental Revenue by Listing and Channel", input.model.channelChartData.revenue],
    ["Reservations by Listing and Channel", input.model.channelChartData.reservations],
  ] as const) {
    ws.addRow([label]).font = arial({ bold: true })
    ws.addRow(["Listing", ...data.channels]).font = arial({ bold: true })
    data.listings.forEach((listing, i) => {
      ws.addRow([listing, ...matrix[i]]).font = arial()
    })
    ws.addRow([])
  }
}

// ---------------------------------------------------------------------------

export async function buildGrantStyleWorkbook(
  input: GrantWorkbookInput
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const mixed = input.model.currentKpis.currencies.length > 1
  const detailMoneyFmt = mixed ? "#,##0" : '"$"#,##0'

  addSummarySheet(wb, input)
  addDetailSheet(wb, "Reservations", "ReservationsCurrent", input.currentRows, detailMoneyFmt, false)
  addDetailSheet(wb, "Previous Period", "ReservationsPrevious", input.previousRows, detailMoneyFmt, false)
  addDetailSheet(wb, "Last Year", "ReservationsLastYear", input.lastYearRows, detailMoneyFmt, true)
  addComparisonSheet(wb, input)
  addOccupancySheet(wb, input)
  addChartDataSheet(wb, input)

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export type { ListingComparisonRow }
