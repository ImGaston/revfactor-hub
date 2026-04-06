"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Upload, FileSpreadsheet, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { importLeads, type ImportLeadRow } from "./actions"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EXPECTED_HEADERS = [
  "project_name",
  "full_name",
  "email",
  "phone",
  "service_type",
  "lead_source",
  "description",
  "scheduled_date",
  "timezone",
  "location",
  "stage",
]

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = values[i]?.trim() ?? ""
    })
    return row
  })

  return { headers, rows }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

export function ImportLeadsDialog({ open, onOpenChange }: Props) {
  const [parsedRows, setParsedRows] = useState<ImportLeadRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [fileName, setFileName] = useState("")
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function reset() {
    setParsedRows([])
    setErrors([])
    setFileName("")
    if (fileRef.current) fileRef.current.value = ""
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setErrors([])

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { headers, rows } = parseCSV(text)

      if (!headers.includes("project_name")) {
        setErrors(["CSV must contain a 'project_name' column."])
        setParsedRows([])
        return
      }

      const validationErrors: string[] = []
      const validRows: ImportLeadRow[] = []

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (!row.project_name) {
          validationErrors.push(`Row ${i + 2}: missing project_name`)
          continue
        }
        validRows.push({
          project_name: row.project_name,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          service_type: row.service_type,
          lead_source: row.lead_source,
          description: row.description,
          scheduled_date: row.scheduled_date,
          timezone: row.timezone,
          location: row.location,
          stage: row.stage,
        })
      }

      setErrors(validationErrors)
      setParsedRows(validRows)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    const result = await importLeads(parsedRows)
    setImporting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Imported ${result.count} leads`)
      reset()
      onOpenChange(false)
      router.refresh()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
          <DialogDescription>
            Upload a CSV file with lead data. Required column:{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              project_name
            </code>
            . Optional:{" "}
            {EXPECTED_HEADERS.filter((h) => h !== "project_name")
              .map((h) => (
                <code
                  key={h}
                  className="text-xs bg-muted px-1 py-0.5 rounded"
                >
                  {h}
                </code>
              ))
              .reduce<React.ReactNode[]>((acc, el, i) => {
                if (i > 0) acc.push(", ")
                acc.push(el)
                return acc
              }, [])}
          </DialogDescription>
        </DialogHeader>

        {/* Upload area */}
        {parsedRows.length === 0 && (
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">
              Click to upload or drag a CSV file
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              .csv files only
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        )}

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertCircle className="size-4" />
              {errors.length} validation{" "}
              {errors.length === 1 ? "issue" : "issues"}
            </div>
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-destructive/80">
                {err}
              </p>
            ))}
          </div>
        )}

        {/* Preview */}
        {parsedRows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{fileName}</span>
                <Badge variant="secondary" className="text-xs">
                  {parsedRows.length} lead{parsedRows.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                Change file
              </Button>
            </div>

            <ScrollArea className="h-[300px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Project Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.project_name}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.full_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.email || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.stage || "inquiry"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.lead_source || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing
                  ? "Importing..."
                  : `Import ${parsedRows.length} Lead${parsedRows.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
