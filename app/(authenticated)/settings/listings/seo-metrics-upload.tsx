"use client"

import { useRef, useState } from "react"
import { Upload, FileUp, X, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { parseSeoMetricsCsv, type SeoMetricRow } from "@/lib/seo-metrics"
import {
  clearSeoMetricsForUploadAction,
  insertSeoMetricsChunkAction,
} from "./actions"

const CHUNK_SIZE = 2000

type Parsed = {
  fileName: string
  rows: SeoMetricRow[]
  downloadDates: string[]
  distinctAirbnbIds: string[]
}

export function SeoMetricsUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  function reset() {
    setParsed(null)
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function handleFile(file: File) {
    const text = await file.text()
    const result = parseSeoMetricsCsv(text)
    if (result.error) {
      toast.error(result.error)
      reset()
      return
    }
    if (result.rows.length === 0) {
      toast.error("No data rows found in the file.")
      reset()
      return
    }
    setParsed({
      fileName: file.name,
      rows: result.rows,
      downloadDates: result.downloadDates,
      distinctAirbnbIds: result.distinctAirbnbIds,
    })
    setProgress(0)
  }

  async function handleUpload() {
    if (!parsed) return
    setUploading(true)
    setProgress(0)
    try {
      const cleared = await clearSeoMetricsForUploadAction(
        parsed.downloadDates,
        parsed.distinctAirbnbIds,
        parsed.rows.some((r) => !r.airbnb_id)
      )
      if (cleared.error) {
        toast.error(`Failed to clear old data: ${cleared.error}`)
        return
      }

      let inserted = 0
      for (let i = 0; i < parsed.rows.length; i += CHUNK_SIZE) {
        const chunk = parsed.rows.slice(i, i + CHUNK_SIZE)
        const res = await insertSeoMetricsChunkAction(chunk)
        if (res.error) {
          toast.error(`Upload failed after ${inserted} rows: ${res.error}`)
          return
        }
        inserted += res.inserted
        setProgress(Math.round((inserted / parsed.rows.length) * 100))
      }

      toast.success(`Uploaded ${inserted.toLocaleString()} rows to seo_metrics.`)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="size-4" />
            SEO Metrics Upload
          </CardTitle>
          <CardDescription>
            Upload a Rankbreeze <span className="font-mono">listing-metrics</span>{" "}
            CSV to load impressions, views, conversion, occupancy, ADR, and search
            rank into <span className="font-mono">seo_metrics</span>. Full and
            single-listing exports both work: re-uploading replaces existing rows
            only for the listings and download date in the file, so a partial
            export refreshes those listings without touching the rest.
          </CardDescription>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <FileUp className="mr-1 size-4" />
          Choose CSV
        </Button>
      </CardHeader>
      <CardContent>
        {!parsed ? (
          <p className="text-sm text-muted-foreground">
            No file selected. Choose a listing-metrics export to preview it before
            uploading.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{parsed.fileName}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {parsed.rows.length.toLocaleString()} rows
                  </Badge>
                  <Badge variant="secondary">
                    {parsed.distinctAirbnbIds.length} listings
                  </Badge>
                  <span>
                    Download date{parsed.downloadDates.length !== 1 ? "s" : ""}:{" "}
                    {parsed.downloadDates.join(", ")}
                  </span>
                </div>
              </div>
              {!uploading && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={reset}
                  aria-label="Clear selected file"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleUpload} disabled={uploading}>
                <Upload className="mr-1 size-4" />
                {uploading ? `Uploading… ${progress}%` : "Upload to seo_metrics"}
              </Button>
              {uploading && (
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
