"use client"

import { useState, useTransition, type ChangeEvent } from "react"
import {
  Check,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  LockKeyhole,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import {
  PERIOD_OPTIONS,
  PROPERTY_STAGE_OPTIONS,
  REVENUE_BASIS_OPTIONS,
  REVENUE_DEDUCTION_OPTIONS,
  REVENUE_INCLUDE_OPTIONS,
  emptyListingReviewProperty,
  validateListingReviewFile,
  type ListingReviewDraft,
  type ListingReviewPropertyDraft,
} from "@/lib/listing-reviews"
import type {
  ListingReviewFileRecord,
  PublicListingReview,
} from "@/lib/listing-reviews.server"
import {
  confirmListingReviewUploadAction,
  deleteListingReviewFileAction,
  prepareListingReviewUploadAction,
  saveListingReviewAction,
  submitListingReviewAction,
} from "./actions"

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "MXN"]

export function ListingReviewForm({
  request,
}: {
  request: PublicListingReview
}) {
  const [draft, setDraft] = useState<ListingReviewDraft>(request.draft_payload)
  const [revision, setRevision] = useState(request.revision)
  const [files, setFiles] = useState(request.files)
  const [lastSavedAt, setLastSavedAt] = useState(request.last_saved_at)
  const [submitted, setSubmitted] = useState(
    request.status === "submitted" ||
      request.status === "in_review" ||
      request.status === "completed"
  )
  const [isSaving, startSaving] = useTransition()
  const [isSubmitting, startSubmitting] = useTransition()
  const [uploadingProperty, setUploadingProperty] = useState<number | null>(
    null
  )

  if (request.status === "cancelled") {
    return (
      <Card className="mx-auto max-w-2xl shadow-e2">
        <CardContent className="px-6 py-14 text-center sm:px-12">
          <h1 className="text-2xl font-semibold tracking-tight">
            This listing review is closed
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This private link is no longer accepting changes. Contact your
            RevFactor representative if you still need to share information.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card className="mx-auto max-w-2xl shadow-e2">
        <CardContent className="flex flex-col items-center px-6 py-14 text-center sm:px-12">
          <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="size-7" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your listing review is submitted
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            Thank you, {request.prospect_name}. Your files and revenue details
            are now in RevFactor&apos;s secure review queue. The team will
            follow up after reviewing the information.
          </p>
        </CardContent>
      </Card>
    )
  }

  function updateProperty(
    index: number,
    patch: Partial<ListingReviewPropertyDraft>
  ) {
    setDraft((current) => ({
      ...current,
      properties: current.properties.map((property, propertyIndex) =>
        propertyIndex === index ? { ...property, ...patch } : property
      ),
    }))
  }

  function changePropertyCount(value: string) {
    const count = Number(value)
    if (files.some((file) => file.property_number > count)) {
      toast.error("Remove files from the properties you want to remove first.")
      return
    }
    const nextDraft: ListingReviewDraft = {
      propertyCount: count,
      properties: Array.from(
        { length: count },
        (_, index) => draft.properties[index] ?? emptyListingReviewProperty()
      ),
    }
    setDraft(nextDraft)
    startSaving(async () => {
      const result = await saveListingReviewAction({
        token: request.public_token,
        expectedRevision: revision,
        draft: nextDraft,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setRevision(result.revision)
      setLastSavedAt(result.lastSavedAt)
    })
  }

  function saveDraft() {
    startSaving(async () => {
      const result = await saveListingReviewAction({
        token: request.public_token,
        expectedRevision: revision,
        draft,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setRevision(result.revision)
      setLastSavedAt(result.lastSavedAt)
      toast.success("Progress saved")
    })
  }

  function submitReview() {
    startSubmitting(async () => {
      const saveResult = await saveListingReviewAction({
        token: request.public_token,
        expectedRevision: revision,
        draft,
      })
      if ("error" in saveResult) {
        toast.error(saveResult.error)
        return
      }
      setRevision(saveResult.revision)
      setLastSavedAt(saveResult.lastSavedAt)

      const submitResult = await submitListingReviewAction({
        token: request.public_token,
        expectedRevision: saveResult.revision,
        draft,
      })
      if ("error" in submitResult) {
        toast.error(submitResult.error)
        return
      }
      setRevision(submitResult.revision)
      setSubmitted(true)
    })
  }

  async function uploadFiles(
    propertyNumber: number,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (selected.length === 0) return

    const existingCount = files.filter(
      (file) => file.property_number === propertyNumber
    ).length
    if (existingCount + selected.length > 5) {
      toast.error("You can upload up to 5 files per property.")
      return
    }

    setUploadingProperty(propertyNumber)
    try {
      const supabase = createClient()
      for (const file of selected) {
        const validationError = validateListingReviewFile(file)
        if (validationError) {
          toast.error(`${file.name}: ${validationError}`)
          continue
        }

        const metadata = { name: file.name, size: file.size, type: file.type }
        const prepared = await prepareListingReviewUploadAction({
          token: request.public_token,
          propertyNumber,
          file: metadata,
        })
        if ("error" in prepared) {
          toast.error(prepared.error)
          continue
        }

        const { error: uploadError } = await supabase.storage
          .from("listing-review-financials")
          .uploadToSignedUrl(prepared.path, prepared.uploadToken, file, {
            contentType: prepared.mimeType,
            upsert: false,
          })
        if (uploadError) {
          toast.error(`${file.name} could not be uploaded.`)
          continue
        }

        const confirmed = await confirmListingReviewUploadAction({
          token: request.public_token,
          propertyNumber,
          storagePath: prepared.path,
          file: metadata,
        })
        if ("error" in confirmed) {
          toast.error(confirmed.error)
          continue
        }
        setFiles((current) => [...current, confirmed.file])
        toast.success(`${file.name} uploaded securely`)
      }
    } finally {
      setUploadingProperty(null)
    }
  }

  async function removeFile(file: ListingReviewFileRecord) {
    const result = await deleteListingReviewFileAction({
      token: request.public_token,
      fileId: file.id,
    })
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    setFiles((current) =>
      current.filter((candidate) => candidate.id !== file.id)
    )
    toast.success("File removed")
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-e2">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit gap-1.5">
              <ShieldCheck className="size-3.5" /> Secure intake
            </Badge>
            <CardTitle className="text-2xl sm:text-3xl">
              Let&apos;s review your listing performance
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">
              Confirm each property, define the revenue figures you&apos;re
              sharing, upload supporting financial reports, and tell us what you
              expect the property to earn.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-4" /> Private and encrypted
          </div>
        </CardHeader>
        <CardContent>
          <Alert>
            <LockKeyhole className="size-4" />
            <AlertTitle>Share property reports, not account access</AlertTitle>
            <AlertDescription>
              Upload PDF, CSV, or XLSX reports only. Please do not upload bank
              statements, tax returns, passwords, or files containing
              unnecessary account numbers.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card className="shadow-e1">
        <CardHeader>
          <CardTitle className="text-lg">
            How many properties should we review?
          </CardTitle>
          <CardDescription>
            Choose one, two, or three. Only those property sections will appear.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={String(draft.propertyCount)}
            onValueChange={changePropertyCount}
            disabled={isSaving}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 property</SelectItem>
              <SelectItem value="2">2 properties</SelectItem>
              <SelectItem value="3">3 properties</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {draft.properties.map((property, index) => (
        <PropertyCard
          key={index}
          index={index}
          property={property}
          files={files.filter((file) => file.property_number === index + 1)}
          uploading={uploadingProperty === index + 1}
          onChange={(patch) => updateProperty(index, patch)}
          onUpload={(event) => uploadFiles(index + 1, event)}
          onRemoveFile={removeFile}
        />
      ))}

      <Card className="shadow-e2">
        <CardContent className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Ready when you are</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastSavedAt
                ? `Last saved ${new Date(lastSavedAt).toLocaleString()}`
                : "Save now and return through this same private link later."}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={saveDraft}
              disabled={isSaving || isSubmitting || uploadingProperty !== null}
            >
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              Save progress
            </Button>
            <Button
              onClick={submitReview}
              disabled={isSaving || isSubmitting || uploadingProperty !== null}
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
              Submit for review
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PropertyCard({
  index,
  property,
  files,
  uploading,
  onChange,
  onUpload,
  onRemoveFile,
}: {
  index: number
  property: ListingReviewPropertyDraft
  files: ListingReviewFileRecord[]
  uploading: boolean
  onChange: (patch: Partial<ListingReviewPropertyDraft>) => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onRemoveFile: (file: ListingReviewFileRecord) => void
}) {
  return (
    <Card className="shadow-e1">
      <CardHeader className="border-b">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {index + 1}
          </span>
          <div>
            <CardTitle className="text-xl">Property {index + 1}</CardTitle>
            <CardDescription>
              Property identity, actual revenue, target, and supporting files.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <Section title="Confirm the property">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Property name or nickname" required>
              <Input
                value={property.propertyName}
                onChange={(event) =>
                  onChange({ propertyName: event.target.value })
                }
                placeholder="Harbor House"
              />
            </FormField>
            <FormField label="Current stage">
              <OptionSelect
                value={property.stage}
                options={PROPERTY_STAGE_OPTIONS}
                onChange={(stage) =>
                  onChange({
                    stage: stage as ListingReviewPropertyDraft["stage"],
                  })
                }
              />
            </FormField>
          </div>
          <FormField
            label="Is this the correct property address?"
            hint="If it needs correction, enter the correct address below."
          >
            <OptionSelect
              value={property.addressStatus}
              options={[
                { value: "confirmed", label: "Yes, confirmed" },
                { value: "corrected", label: "No, I am correcting it" },
                { value: "not_sure", label: "I am not sure" },
              ]}
              onChange={(addressStatus) =>
                onChange({
                  addressStatus:
                    addressStatus as ListingReviewPropertyDraft["addressStatus"],
                })
              }
            />
          </FormField>
          <FormField label="Full property address" required>
            <Input
              value={property.address}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="Street, city, state/province, postal code, country"
            />
          </FormField>
          <FormField
            label="Listing links (optional)"
            hint="One URL per line — Airbnb, Vrbo, direct-booking site, or another public listing."
          >
            <Textarea
              value={property.listingUrls.join("\n")}
              onChange={(event) =>
                onChange({
                  listingUrls: event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean)
                    .slice(0, 5),
                })
              }
              placeholder="https://www.airbnb.com/rooms/..."
              rows={3}
            />
          </FormField>
        </Section>

        <Separator />

        <Section
          title="Define actual revenue"
          description="Use the total shown in the reports you are uploading. The questions below tell us how to interpret it."
        >
          <div className="grid gap-5 sm:grid-cols-[1fr_140px]">
            <FormField label="Reported revenue" required>
              <Input
                inputMode="decimal"
                value={property.actualRevenue}
                onChange={(event) =>
                  onChange({ actualRevenue: event.target.value })
                }
                placeholder="82500.00"
              />
            </FormField>
            <FormField label="Currency" required>
              <CurrencySelect
                value={property.actualCurrency}
                onChange={(actualCurrency) => onChange({ actualCurrency })}
              />
            </FormField>
          </div>
          <PeriodFields
            prefix="actual"
            property={property}
            onChange={onChange}
          />
          <FormField label="Is this gross or net revenue?" required>
            <OptionSelect
              value={property.actualBasis}
              options={REVENUE_BASIS_OPTIONS}
              onChange={(actualBasis) =>
                onChange({
                  actualBasis:
                    actualBasis as ListingReviewPropertyDraft["actualBasis"],
                })
              }
            />
          </FormField>
          <Alert>
            <FileSpreadsheet className="size-4" />
            <AlertTitle>Our gross-revenue definition</AlertTitle>
            <AlertDescription>
              Accommodation revenue before platform, payment, management, or
              operating costs. Taxes and refundable deposits are excluded. Use
              the checkboxes to flag cleaning or other guest fees.
            </AlertDescription>
          </Alert>
          <CheckboxGroup
            label="What does the reported amount include?"
            options={REVENUE_INCLUDE_OPTIONS}
            values={property.revenueIncludes}
            onChange={(revenueIncludes) =>
              onChange({
                revenueIncludes:
                  revenueIncludes as ListingReviewPropertyDraft["revenueIncludes"],
              })
            }
          />
          <CheckboxGroup
            label="What has already been deducted from the reported amount?"
            options={REVENUE_DEDUCTION_OPTIONS}
            values={property.deductionsTaken}
            onChange={(deductionsTaken) =>
              onChange({
                deductionsTaken:
                  deductionsTaken as ListingReviewPropertyDraft["deductionsTaken"],
              })
            }
          />
          <FormField
            label="Anything else about how this revenue figure is calculated? (optional)"
            hint="Explain any other included income, deductions, or uncertainty in the report."
          >
            <Textarea
              value={property.revenueDefinitionNotes}
              onChange={(event) =>
                onChange({ revenueDefinitionNotes: event.target.value })
              }
              rows={3}
              placeholder="For example: the PMS total includes a pet fee, or cleaning costs are deducted elsewhere."
            />
          </FormField>
        </Section>

        <Separator />

        <Section
          title="Share your expectation"
          description="This lets us compare your target with the historical performance on the same basis."
        >
          <div className="grid gap-5 sm:grid-cols-[1fr_140px]">
            <FormField label="Expected revenue" required>
              <Input
                inputMode="decimal"
                value={property.targetRevenue}
                onChange={(event) =>
                  onChange({ targetRevenue: event.target.value })
                }
                placeholder="110000.00"
              />
            </FormField>
            <FormField label="Currency" required>
              <CurrencySelect
                value={property.targetCurrency}
                onChange={(targetCurrency) => onChange({ targetCurrency })}
              />
            </FormField>
          </div>
          <PeriodFields
            prefix="target"
            property={property}
            onChange={onChange}
          />
          <FormField label="Target basis" required>
            <OptionSelect
              value={property.targetBasis}
              options={REVENUE_BASIS_OPTIONS}
              onChange={(targetBasis) =>
                onChange({
                  targetBasis:
                    targetBasis as ListingReviewPropertyDraft["targetBasis"],
                })
              }
            />
          </FormField>
          <FormField label="What is behind this expectation? (optional)">
            <Textarea
              value={property.expectationNotes}
              onChange={(event) =>
                onChange({ expectationNotes: event.target.value })
              }
              placeholder="Prior-year performance, investment objective, mortgage requirement, planned improvements..."
              rows={3}
            />
          </FormField>
          <FormField label="Constraints or context we should know (optional)">
            <Textarea
              value={property.constraints}
              onChange={(event) =>
                onChange({ constraints: event.target.value })
              }
              placeholder="Owner-use dates, HOA rules, permit limits, renovations, minimum revenue needs..."
              rows={3}
            />
          </FormField>
        </Section>

        <Separator />

        <Section
          title="Upload supporting financials"
          description="Attach one or more property-level reports for the period above. At least one file is required per property."
        >
          <div className="rounded-xl border border-dashed bg-muted/30 p-5">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium">PDF, CSV, or XLSX</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Up to 5 files, 20 MB each. Files remain private.
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                disabled={uploading || files.length >= 5}
              >
                <Label className="cursor-pointer">
                  {uploading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  {uploading ? "Uploading…" : "Choose files"}
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.csv,.xlsx"
                    className="sr-only"
                    onChange={onUpload}
                    disabled={uploading || files.length >= 5}
                  />
                </Label>
              </Button>
            </div>
            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2"
                  >
                    {file.mime_type === "application/pdf" ? (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {file.file_name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatBytes(file.byte_size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${file.file_name}`}
                      onClick={() => onRemoveFile(file)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      </CardContent>
    </Card>
  )
}

function PeriodFields({
  prefix,
  property,
  onChange,
}: {
  prefix: "actual" | "target"
  property: ListingReviewPropertyDraft
  onChange: (patch: Partial<ListingReviewPropertyDraft>) => void
}) {
  const kindKey = `${prefix}PeriodKind` as
    | "actualPeriodKind"
    | "targetPeriodKind"
  const yearKey = `${prefix}PeriodYear` as
    | "actualPeriodYear"
    | "targetPeriodYear"
  const startKey = `${prefix}PeriodStart` as
    | "actualPeriodStart"
    | "targetPeriodStart"
  const endKey = `${prefix}PeriodEnd` as "actualPeriodEnd" | "targetPeriodEnd"
  const kind = property[kindKey]

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <FormField label="Revenue period" required>
        <OptionSelect
          value={kind}
          options={PERIOD_OPTIONS}
          onChange={(value) =>
            onChange({
              [kindKey]: value,
            } as Partial<ListingReviewPropertyDraft>)
          }
        />
      </FormField>
      {kind === "calendar_year" && (
        <FormField label="Calendar year" required>
          <Input
            inputMode="numeric"
            maxLength={4}
            value={property[yearKey]}
            onChange={(event) =>
              onChange({
                [yearKey]: event.target.value,
              } as Partial<ListingReviewPropertyDraft>)
            }
            placeholder="2026"
          />
        </FormField>
      )}
      {kind === "custom" && (
        <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
          <FormField label="Period start" required>
            <Input
              type="date"
              value={property[startKey]}
              onChange={(event) =>
                onChange({
                  [startKey]: event.target.value,
                } as Partial<ListingReviewPropertyDraft>)
              }
            />
          </FormField>
          <FormField label="Period end" required>
            <Input
              type="date"
              value={property[endKey]}
              onChange={(event) =>
                onChange({
                  [endKey]: event.target.value,
                } as Partial<ListingReviewPropertyDraft>)
              }
            />
          </FormField>
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

function OptionSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CurrencySelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <OptionSelect
      value={value}
      options={CURRENCIES.map((currency) => ({
        value: currency,
        label: currency,
      }))}
      onChange={onChange}
    />
  )
}

function CheckboxGroup({
  label,
  options,
  values,
  onChange,
}: {
  label: string
  options: readonly { value: string; label: string }[]
  values: readonly string[]
  onChange: (values: string[]) => void
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const checked = values.includes(option.value)
          return (
            <Label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm font-normal hover:bg-muted/40"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? [...values, option.value]
                      : values.filter((value) => value !== option.value)
                  )
                }
              />
              <span>{option.label}</span>
            </Label>
          )
        })}
      </div>
    </fieldset>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
