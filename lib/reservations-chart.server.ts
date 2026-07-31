// Server-only chart rendering for the Grant-style report. ExcelJS has no
// stable native-chart API, so charts are hand-rolled SVG (no chart library)
// rasterized to PNG with sharp and embedded via workbook.addImage().

import sharp from "sharp"
import type { CanonicalChannel } from "@/lib/reservations-export"

// Stable per-channel colors so charts stay comparable across reports
export const CHANNEL_COLORS: Record<CanonicalChannel, string> = {
  Airbnb: "#FF5A5F",
  "Vrbo/Homeaway": "#3B5BDB",
  "Booking.com": "#003580",
  "Booking Engine/Direct Website": "#38761D",
  "Direct/Manual": "#E69138",
  Marriott: "#741B47",
  Partner: "#674EA7",
  Google: "#4285F4",
  Other: "#999999",
}

export type StackedBarChartInput = {
  title: string
  categories: string[] // listing names, one horizontal bar each
  series: { name: string; color: string; values: number[] }[]
  valueKind: "money" | "count"
  currencySymbol: string // "" when currencies are mixed
}

const FONT = "Arial, Helvetica, sans-serif"
const WIDTH = 900
const GUTTER_LEFT = 250
const GUTTER_RIGHT = 30
const TITLE_H = 34
const LEGEND_H = 26
const AXIS_H = 28
const BAR_H = 22
const BAR_GAP = 10

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatValue(value: number, kind: "money" | "count", symbol: string): string {
  if (kind === "count") return String(Math.round(value))
  const abs = Math.abs(value)
  if (abs >= 1000) return `${symbol}${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `${symbol}${Math.round(value)}`
}

function niceMax(value: number, kind: "money" | "count"): number {
  if (value <= 0) return 1
  if (kind === "count") {
    // integer tick steps so axis labels never land on fractions
    return Math.max(4, Math.ceil(value / 4) * 4)
  }
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (value <= magnitude * mult) return magnitude * mult
  }
  return magnitude * 10
}

export function renderStackedBarChartSvg(input: StackedBarChartInput): string {
  const { title, categories, series, valueKind, currencySymbol } = input
  const rows = categories.length
  const plotW = WIDTH - GUTTER_LEFT - GUTTER_RIGHT
  const plotTop = TITLE_H + LEGEND_H
  const plotH = rows * (BAR_H + BAR_GAP)
  const height = plotTop + plotH + AXIS_H

  const totals = categories.map((_, i) =>
    series.reduce((acc, s) => acc + (s.values[i] ?? 0), 0)
  )
  const max = niceMax(Math.max(...totals, 0), valueKind)
  const scale = plotW / max

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * 2}" height="${height * 2}" viewBox="0 0 ${WIDTH} ${height}">`
  )
  parts.push(`<rect width="${WIDTH}" height="${height}" fill="#FFFFFF"/>`)
  parts.push(
    `<text x="12" y="22" font-family="${FONT}" font-size="16" font-weight="bold" fill="#13342D">${esc(title)}</text>`
  )

  // legend
  let legendX = 12
  for (const s of series) {
    parts.push(
      `<rect x="${legendX}" y="${TITLE_H + 4}" width="10" height="10" rx="2" fill="${s.color}"/>`
    )
    const label = truncate(s.name, 30)
    parts.push(
      `<text x="${legendX + 14}" y="${TITLE_H + 13}" font-family="${FONT}" font-size="11" fill="#333333">${esc(label)}</text>`
    )
    legendX += 14 + label.length * 6 + 16
  }

  // vertical gridlines + axis labels
  const ticks = 4
  for (let t = 0; t <= ticks; t++) {
    const x = GUTTER_LEFT + (plotW * t) / ticks
    parts.push(
      `<line x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotTop + plotH}" stroke="#E5E5E5" stroke-width="1"/>`
    )
    parts.push(
      `<text x="${x}" y="${plotTop + plotH + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#666666">${esc(formatValue((max * t) / ticks, valueKind, currencySymbol))}</text>`
    )
  }

  // bars
  categories.forEach((category, i) => {
    const y = plotTop + i * (BAR_H + BAR_GAP) + BAR_GAP / 2
    parts.push(
      `<text x="${GUTTER_LEFT - 8}" y="${y + BAR_H / 2 + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#333333">${esc(truncate(category, 36))}</text>`
    )
    let x = GUTTER_LEFT
    for (const s of series) {
      const value = s.values[i] ?? 0
      if (value <= 0) continue
      const w = value * scale
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${BAR_H}" fill="${s.color}"/>`
      )
      x += w
    }
    if (totals[i] > 0) {
      parts.push(
        `<text x="${x + 6}" y="${y + BAR_H / 2 + 4}" font-family="${FONT}" font-size="11" fill="#333333">${esc(formatValue(totals[i], valueKind, currencySymbol))}</text>`
      )
    }
  })

  parts.push("</svg>")
  return parts.join("")
}

export type RenderedChart = {
  png: Buffer
  width: number // layout px for worksheet placement (PNG is rendered at 2x)
  height: number
}

export async function renderStackedBarChartPng(
  input: StackedBarChartInput
): Promise<RenderedChart> {
  const svg = renderStackedBarChartSvg(input)
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const height =
    TITLE_H + LEGEND_H + input.categories.length * (BAR_H + BAR_GAP) + AXIS_H
  return { png, width: WIDTH, height }
}
