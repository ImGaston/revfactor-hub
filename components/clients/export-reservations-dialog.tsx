"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  addDays,
  buildExportFilename,
  type ExportDateField,
} from "@/lib/reservations-export"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ExportReservationsDialog({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const [open, setOpen] = useState(false)
  const [dateField, setDateField] = useState<ExportDateField>("booked_date")
  // Grant-style default: last 28 days ending today
  const [from, setFrom] = useState(() => addDays(todayIso(), -27))
  const [to, setTo] = useState(todayIso)
  const [asOf, setAsOf] = useState(todayIso)
  const [exporting, setExporting] = useState(false)

  const missingRange = from === "" || to === ""
  const invertedRange = !missingRange && from > to
  const canExport = !exporting && !missingRange && !invertedRange && asOf !== ""

  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ dateField, from, to, asOf })
      const res = await fetch(`/clients/${clientId}/export?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(body?.error ?? "Failed to export the report")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = buildExportFilename(clientName, from, to)
      link.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch {
      toast.error("Failed to export the report")
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-1 size-3" />
          Export Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Grant-style report</DialogTitle>
          <DialogDescription>
            Download an Excel report with {clientName}&apos;s reservations,
            KPIs, channel and listing breakdowns, monthly pickup, occupancy and
            period comparisons.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-date-field">Date field</Label>
            <Select
              value={dateField}
              onValueChange={(v) => setDateField(v as ExportDateField)}
            >
              <SelectTrigger id="export-date-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="booked_date">Booked Date</SelectItem>
                <SelectItem value="check_in">Check-in (advanced)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Period</Label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Period from"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Period to"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {missingRange
                ? "Both dates are required."
                : invertedRange
                  ? "The from date must be before the to date."
                  : "The report compares against the previous month aligned by day of month (e.g. Jul 1–28 vs Jun 1–28) and the same period last year."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="export-as-of">As-of date</Label>
            <Input
              id="export-as-of"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              aria-label="As-of date"
            />
            <p className="text-xs text-muted-foreground">
              Used for the occupancy horizons and the monthly pickup cutoff.
              Defaults to today.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleExport} disabled={!canExport}>
            {exporting ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Download className="mr-1 size-3" />
            )}
            {exporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
