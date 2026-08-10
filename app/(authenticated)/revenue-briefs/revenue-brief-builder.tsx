"use client"

import { useMemo, useRef, useState } from "react"
import {
  Download,
  FileCheck2,
  ImagePlus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  RevenueBriefSchema,
  SYNTHETIC_REVENUE_BRIEF,
  createBlankRevenueBrief,
  revenueBriefFilename,
  type RevenueBriefInput,
} from "@/lib/revenue-brief/schema"

type ValidationIssue = { path: string; message: string }

const cloneBrief = (brief: RevenueBriefInput): RevenueBriefInput =>
  JSON.parse(JSON.stringify(brief)) as RevenueBriefInput

export function RevenueBriefBuilder() {
  const [brief, setBrief] = useState<RevenueBriefInput>(() => createBlankRevenueBrief())
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [generating, setGenerating] = useState(false)
  const [photoName, setPhotoName] = useState("")
  const photoInputRef = useRef<HTMLInputElement>(null)

  const issueMap = useMemo(
    () => new Map(issues.map((issue) => [issue.path, issue.message])),
    [issues]
  )

  function update<K extends keyof RevenueBriefInput>(key: K, value: RevenueBriefInput[K]) {
    setBrief((current) => ({ ...current, [key]: value }))
    setIssues([])
  }

  function updateMetric(key: keyof RevenueBriefInput["metrics"], value: string) {
    setBrief((current) => ({
      ...current,
      metrics: { ...current.metrics, [key]: value },
    }))
    setIssues([])
  }

  function updateDemandDriver(
    index: number,
    key: keyof RevenueBriefInput["demandDrivers"][number],
    value: string
  ) {
    const next = brief.demandDrivers.map((driver, itemIndex) =>
      itemIndex === index ? { ...driver, [key]: value } : driver
    )
    update("demandDrivers", next)
  }

  function updateRevenueLever(
    index: number,
    key: keyof RevenueBriefInput["revenueLevers"][number],
    value: string
  ) {
    const next = brief.revenueLevers.map((lever, itemIndex) =>
      itemIndex === index ? { ...lever, [key]: value } : lever
    )
    update("revenueLevers", next)
  }

  function updateFirstMonth(
    index: number,
    key: keyof RevenueBriefInput["firstMonth"][number],
    value: string
  ) {
    const next = brief.firstMonth.map((step, itemIndex) =>
      itemIndex === index ? { ...step, [key]: value } : step
    )
    update("firstMonth", next)
  }

  function updateBenchmark(
    index: number,
    key: keyof RevenueBriefInput["benchmarks"][number],
    value: string
  ) {
    const next = brief.benchmarks.map((benchmark, itemIndex) =>
      itemIndex === index ? { ...benchmark, [key]: value } : benchmark
    )
    update("benchmarks", next)
  }

  function resetBrief() {
    setBrief(createBlankRevenueBrief())
    setIssues([])
    setPhotoName("")
    if (photoInputRef.current) photoInputRef.current.value = ""
  }

  function loadExample() {
    setBrief(cloneBrief(SYNTHETIC_REVENUE_BRIEF))
    setIssues([])
    setPhotoName("")
    if (photoInputRef.current) photoInputRef.current.value = ""
    toast.success("Synthetic example loaded")
  }

  function handlePhoto(file: File | undefined) {
    if (!file) return
    if (!/image\/(jpeg|png)/.test(file.type)) {
      toast.error("Use a JPG or PNG cover image")
      return
    }
    if (file.size > 2_000_000) {
      toast.error("Cover image must be smaller than 2 MB")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") return
      update("photoDataUrl", reader.result)
      setPhotoName(file.name)
    }
    reader.onerror = () => toast.error("The cover image could not be read")
    reader.readAsDataURL(file)
  }

  async function generatePdf() {
    const parsed = RevenueBriefSchema.safeParse(brief)
    if (!parsed.success) {
      const nextIssues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
      setIssues(nextIssues)
      toast.error("Review the incomplete brief fields")
      return
    }

    setGenerating(true)
    setIssues([])
    try {
      const response = await fetch("/api/revenue-briefs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; issues?: ValidationIssue[] }
          | null
        if (body?.issues) setIssues(body.issues)
        throw new Error(body?.error || "The PDF could not be generated")
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = revenueBriefFilename(parsed.data)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      toast.success("Client-ready PDF downloaded")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The PDF could not be generated")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Revenue Brief Builder</h1>
            <Badge variant="secondary">Pipeline tool</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Turn a listing review into a consistent, owner-safe RevFactor opportunity brief.
            The PDF is generated for download and is not stored in the Hub.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadExample}>
            <FileCheck2 data-icon="inline-start" />
            Load example
          </Button>
          <Button type="button" variant="ghost" onClick={resetBrief}>
            <RotateCcw data-icon="inline-start" />
            Start over
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <Alert variant="destructive">
          <ShieldCheck />
          <AlertTitle>The brief needs a final review</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {issues.slice(0, 6).map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
              ))}
              {issues.length > 6 && <li>And {issues.length - 6} more fields.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Brief inputs</CardTitle>
            <CardDescription>
              Keep the analysis evidence-based. Only include facts that are visible or verified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="property">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="property">Property</TabsTrigger>
                <TabsTrigger value="opportunity">Opportunity</TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
              </TabsList>

              <TabsContent value="property" className="pt-5">
                <FieldGroup>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field data-invalid={issueMap.has("preparedFor")}>
                      <FieldLabel htmlFor="prepared-for">Prepared for</FieldLabel>
                      <Input
                        id="prepared-for"
                        value={brief.preparedFor}
                        onChange={(event) => update("preparedFor", event.target.value)}
                        placeholder="Owner or prospect name"
                        maxLength={100}
                        aria-invalid={issueMap.has("preparedFor")}
                      />
                      <FieldError>{issueMap.get("preparedFor")}</FieldError>
                    </Field>
                    <Field data-invalid={issueMap.has("propertyName")}>
                      <FieldLabel htmlFor="property-name">Property name</FieldLabel>
                      <Input
                        id="property-name"
                        value={brief.propertyName}
                        onChange={(event) => update("propertyName", event.target.value)}
                        placeholder="Listing or home name"
                        maxLength={120}
                        aria-invalid={issueMap.has("propertyName")}
                      />
                      <FieldError>{issueMap.get("propertyName")}</FieldError>
                    </Field>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <Field data-invalid={issueMap.has("propertyAddress")}>
                      <FieldLabel htmlFor="property-address">Property address</FieldLabel>
                      <Input
                        id="property-address"
                        value={brief.propertyAddress}
                        onChange={(event) => update("propertyAddress", event.target.value)}
                        placeholder="Street, city, state, ZIP"
                        maxLength={180}
                        aria-invalid={issueMap.has("propertyAddress")}
                      />
                      <FieldError>{issueMap.get("propertyAddress")}</FieldError>
                    </Field>
                    <Field data-invalid={issueMap.has("locationLabel")}>
                      <FieldLabel htmlFor="location-label">Cover location</FieldLabel>
                      <Input
                        id="location-label"
                        value={brief.locationLabel}
                        onChange={(event) => update("locationLabel", event.target.value)}
                        placeholder="City, State"
                        maxLength={100}
                        aria-invalid={issueMap.has("locationLabel")}
                      />
                      <FieldError>{issueMap.get("locationLabel")}</FieldError>
                    </Field>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <Field data-invalid={issueMap.has("listingUrl")}>
                      <FieldLabel htmlFor="listing-url">Listing URL</FieldLabel>
                      <Input
                        id="listing-url"
                        type="url"
                        value={brief.listingUrl}
                        onChange={(event) => update("listingUrl", event.target.value)}
                        placeholder="https://www.airbnb.com/rooms/..."
                        maxLength={500}
                        aria-invalid={issueMap.has("listingUrl")}
                      />
                      <FieldError>{issueMap.get("listingUrl")}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="listing-stage">Listing stage</FieldLabel>
                      <Select
                        value={brief.listingStage}
                        onValueChange={(value) =>
                          update("listingStage", value as RevenueBriefInput["listingStage"])
                        }
                      >
                        <SelectTrigger id="listing-stage" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="existing">Existing listing</SelectItem>
                            <SelectItem value="new">New listing</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="cover-photo">Cover photo</FieldLabel>
                    <Input
                      ref={photoInputRef}
                      id="cover-photo"
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={(event) => handlePhoto(event.target.files?.[0])}
                    />
                    <FieldDescription>
                      Optional JPG or PNG, up to 2 MB. {photoName && `Selected: ${photoName}`}
                    </FieldDescription>
                    {brief.photoDataUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          update("photoDataUrl", "")
                          setPhotoName("")
                          if (photoInputRef.current) photoInputRef.current.value = ""
                        }}
                      >
                        <Trash2 data-icon="inline-start" />
                        Remove photo
                      </Button>
                    )}
                  </Field>

                  <FieldSet>
                    <FieldLegend>Listing metrics</FieldLegend>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {(
                        [
                          ["rating", "Airbnb rating", "4.96"],
                          ["reviews", "Reviews", "41"],
                          ["layout", "Layout", "4BR / 3BA"],
                          ["guests", "Guests", "10"],
                        ] as const
                      ).map(([key, label, placeholder]) => (
                        <Field key={key} data-invalid={issueMap.has(`metrics.${key}`)}>
                          <FieldLabel htmlFor={`metric-${key}`}>{label}</FieldLabel>
                          <Input
                            id={`metric-${key}`}
                            value={brief.metrics[key]}
                            onChange={(event) => updateMetric(key, event.target.value)}
                            placeholder={placeholder}
                            maxLength={32}
                            aria-invalid={issueMap.has(`metrics.${key}`)}
                          />
                          <FieldError>{issueMap.get(`metrics.${key}`)}</FieldError>
                        </Field>
                      ))}
                    </div>
                  </FieldSet>

                  <Field>
                    <FieldLabel htmlFor="listing-details">Airbnb specs</FieldLabel>
                    <Textarea
                      id="listing-details"
                      value={brief.listingDetails}
                      onChange={(event) => update("listingDetails", event.target.value)}
                      maxLength={240}
                      rows={2}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="host-signals">Host and trust signals</FieldLabel>
                    <Textarea
                      id="host-signals"
                      value={brief.hostSignals}
                      onChange={(event) => update("hostSignals", event.target.value)}
                      maxLength={240}
                      rows={2}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="positioning">Current positioning</FieldLabel>
                    <Textarea
                      id="positioning"
                      value={brief.currentPositioning}
                      onChange={(event) => update("currentPositioning", event.target.value)}
                      maxLength={360}
                      rows={3}
                    />
                  </Field>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="strengths">Strengths</FieldLabel>
                      <Textarea
                        id="strengths"
                        value={brief.strengths}
                        onChange={(event) => update("strengths", event.target.value)}
                        maxLength={420}
                        rows={4}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="constraints">Visible constraints</FieldLabel>
                      <Textarea
                        id="constraints"
                        value={brief.visibleConstraints}
                        onChange={(event) => update("visibleConstraints", event.target.value)}
                        maxLength={320}
                        rows={4}
                      />
                    </Field>
                  </div>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="opportunity" className="pt-5">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="executive-summary">Executive summary</FieldLabel>
                    <Textarea
                      id="executive-summary"
                      value={brief.executiveSummary}
                      onChange={(event) => update("executiveSummary", event.target.value)}
                      maxLength={520}
                      rows={4}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="bottom-line">Bottom line</FieldLabel>
                    <Textarea
                      id="bottom-line"
                      value={brief.bottomLine}
                      onChange={(event) => update("bottomLine", event.target.value)}
                      maxLength={420}
                      rows={3}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="owner-takeaway">What this means for the listing</FieldLabel>
                    <Textarea
                      id="owner-takeaway"
                      value={brief.ownerTakeaway}
                      onChange={(event) => update("ownerTakeaway", event.target.value)}
                      maxLength={520}
                      rows={4}
                    />
                    <FieldDescription>
                      Write the takeaway directly. Avoid internal framing labels or a guaranteed outcome.
                    </FieldDescription>
                  </Field>

                  <FieldSet>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <FieldLegend>Demand drivers</FieldLegend>
                        <FieldDescription>
                          Add only drivers that materially change booking demand.
                        </FieldDescription>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={brief.demandDrivers.length >= 6}
                        onClick={() =>
                          update("demandDrivers", [
                            ...brief.demandDrivers,
                            { name: "", distance: "", why: "" },
                          ])
                        }
                      >
                        <Plus data-icon="inline-start" />
                        Add driver
                      </Button>
                    </div>
                    <div className="flex flex-col gap-3">
                      {brief.demandDrivers.map((driver, index) => (
                        <Card key={`driver-${index}`}>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between gap-3">
                              <CardTitle className="text-base">Demand driver {index + 1}</CardTitle>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove demand driver ${index + 1}`}
                                disabled={brief.demandDrivers.length === 1}
                                onClick={() =>
                                  update(
                                    "demandDrivers",
                                    brief.demandDrivers.filter((_, itemIndex) => itemIndex !== index)
                                  )
                                }
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-4 md:grid-cols-[1fr_0.55fr_1.7fr]">
                              <Field data-invalid={issueMap.has(`demandDrivers.${index}.name`)}>
                                <FieldLabel htmlFor={`driver-${index}-name`}>Name</FieldLabel>
                                <Input
                                  id={`driver-${index}-name`}
                                  value={driver.name}
                                  onChange={(event) =>
                                    updateDemandDriver(index, "name", event.target.value)
                                  }
                                  maxLength={80}
                                  aria-invalid={issueMap.has(`demandDrivers.${index}.name`)}
                                />
                              </Field>
                              <Field data-invalid={issueMap.has(`demandDrivers.${index}.distance`)}>
                                <FieldLabel htmlFor={`driver-${index}-distance`}>Distance</FieldLabel>
                                <Input
                                  id={`driver-${index}-distance`}
                                  value={driver.distance}
                                  onChange={(event) =>
                                    updateDemandDriver(index, "distance", event.target.value)
                                  }
                                  placeholder="~2.4 mi"
                                  maxLength={30}
                                  aria-invalid={issueMap.has(`demandDrivers.${index}.distance`)}
                                />
                              </Field>
                              <Field data-invalid={issueMap.has(`demandDrivers.${index}.why`)}>
                                <FieldLabel htmlFor={`driver-${index}-why`}>Why it matters</FieldLabel>
                                <Input
                                  id={`driver-${index}-why`}
                                  value={driver.why}
                                  onChange={(event) =>
                                    updateDemandDriver(index, "why", event.target.value)
                                  }
                                  maxLength={180}
                                  aria-invalid={issueMap.has(`demandDrivers.${index}.why`)}
                                />
                              </Field>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </FieldSet>

                  <Field>
                    <FieldLabel htmlFor="distance-note">Distance note</FieldLabel>
                    <Textarea
                      id="distance-note"
                      value={brief.distanceNote}
                      onChange={(event) => update("distanceNote", event.target.value)}
                      maxLength={240}
                      rows={2}
                    />
                  </Field>

                  <FieldSet>
                    <FieldLegend>Revenue levers</FieldLegend>
                    <FieldDescription>
                      The standard five levers are prefilled. Tailor the review and benefit to this property.
                    </FieldDescription>
                    <div className="flex flex-col gap-3">
                      {brief.revenueLevers.map((lever, index) => (
                        <Card key={`lever-${index}`}>
                          <CardContent className="pt-6">
                            <div className="grid gap-4 md:grid-cols-[0.8fr_1.4fr_1fr]">
                              <Field>
                                <FieldLabel htmlFor={`lever-${index}-name`}>Lever</FieldLabel>
                                <Input
                                  id={`lever-${index}-name`}
                                  value={lever.name}
                                  onChange={(event) =>
                                    updateRevenueLever(index, "name", event.target.value)
                                  }
                                  maxLength={80}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`lever-${index}-review`}>What to review</FieldLabel>
                                <Textarea
                                  id={`lever-${index}-review`}
                                  value={lever.review}
                                  onChange={(event) =>
                                    updateRevenueLever(index, "review", event.target.value)
                                  }
                                  maxLength={220}
                                  rows={2}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`lever-${index}-benefit`}>Owner benefit</FieldLabel>
                                <Textarea
                                  id={`lever-${index}-benefit`}
                                  value={lever.benefit}
                                  onChange={(event) =>
                                    updateRevenueLever(index, "benefit", event.target.value)
                                  }
                                  maxLength={180}
                                  rows={2}
                                />
                              </Field>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </FieldSet>

                  <FieldSet>
                    <FieldLegend>First 30 days</FieldLegend>
                    <div className="flex flex-col gap-3">
                      {brief.firstMonth.map((step, index) => (
                        <div key={`step-${index}`} className="grid gap-4 md:grid-cols-[0.35fr_1.65fr]">
                          <Field>
                            <FieldLabel htmlFor={`step-${index}-label`}>Timing</FieldLabel>
                            <Input
                              id={`step-${index}-label`}
                              value={step.label}
                              onChange={(event) =>
                                updateFirstMonth(index, "label", event.target.value)
                              }
                              maxLength={40}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`step-${index}-focus`}>Focus</FieldLabel>
                            <Input
                              id={`step-${index}-focus`}
                              value={step.focus}
                              onChange={(event) =>
                                updateFirstMonth(index, "focus", event.target.value)
                              }
                              maxLength={220}
                            />
                          </Field>
                        </div>
                      ))}
                    </div>
                  </FieldSet>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="evidence" className="pt-5">
                <FieldGroup>
                  <Alert>
                    <ShieldCheck />
                    <AlertTitle>Benchmark guardrail</AlertTitle>
                    <AlertDescription>
                      Keep comparables anonymized. Managed-period lift is evidence of fit, not a guaranteed
                      projection for this property.
                    </AlertDescription>
                  </Alert>

                  <FieldSet>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <FieldLegend>Managed benchmarks</FieldLegend>
                        <FieldDescription>
                          Confirm every value against the current approved RevFactor benchmark set.
                        </FieldDescription>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={brief.benchmarks.length >= 5}
                        onClick={() =>
                          update("benchmarks", [
                            ...brief.benchmarks,
                            {
                              profile: "",
                              managedMonths: "",
                              managedRevenue: "",
                              marketRevenue: "",
                              lift: "",
                              monthlyLift: "",
                            },
                          ])
                        }
                      >
                        <Plus data-icon="inline-start" />
                        Add benchmark
                      </Button>
                    </div>
                    <div className="flex flex-col gap-3">
                      {brief.benchmarks.map((benchmark, index) => (
                        <Card key={`benchmark-${index}`}>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between gap-3">
                              <CardTitle className="text-base">Comparable {index + 1}</CardTitle>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove comparable ${index + 1}`}
                                disabled={brief.benchmarks.length === 1}
                                onClick={() =>
                                  update(
                                    "benchmarks",
                                    brief.benchmarks.filter((_, itemIndex) => itemIndex !== index)
                                  )
                                }
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                              {(
                                [
                                  ["profile", "Comparable profile"],
                                  ["managedMonths", "Managed months analyzed"],
                                  ["managedRevenue", "Managed-period revenue"],
                                  ["marketRevenue", "Market-level revenue"],
                                  ["lift", "Estimated lift"],
                                  ["monthlyLift", "Monthly lift vs. market"],
                                ] as const
                              ).map(([key, label]) => (
                                <Field key={key} data-invalid={issueMap.has(`benchmarks.${index}.${key}`)}>
                                  <FieldLabel htmlFor={`benchmark-${index}-${key}`}>{label}</FieldLabel>
                                  <Input
                                    id={`benchmark-${index}-${key}`}
                                    value={benchmark[key]}
                                    onChange={(event) =>
                                      updateBenchmark(index, key, event.target.value)
                                    }
                                    maxLength={key === "profile" ? 120 : 24}
                                    aria-invalid={issueMap.has(`benchmarks.${index}.${key}`)}
                                  />
                                </Field>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </FieldSet>

                  <Field>
                    <FieldLabel htmlFor="benchmark-summary">What the benchmark supports</FieldLabel>
                    <Textarea
                      id="benchmark-summary"
                      value={brief.benchmarkSummary}
                      onChange={(event) => update("benchmarkSummary", event.target.value)}
                      maxLength={420}
                      rows={4}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="final-data-request">Data needed for the final recommendation</FieldLabel>
                    <Textarea
                      id="final-data-request"
                      value={brief.finalDataRequest}
                      onChange={(event) => update("finalDataRequest", event.target.value)}
                      maxLength={420}
                      rows={4}
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="button" onClick={generatePdf} disabled={generating}>
              {generating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {generating ? "Generating PDF..." : "Generate client PDF"}
            </Button>
          </CardFooter>
        </Card>

        <div className="xl:sticky xl:top-5 xl:self-start">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Content preview</CardTitle>
                <Badge variant="outline">6-page PDF</Badge>
              </div>
              <CardDescription>
                This preview checks the narrative. The downloaded PDF uses the full RevFactor layout.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="rounded-xl bg-primary p-6 text-primary-foreground">
                <p className="text-xs font-medium uppercase tracking-widest opacity-75">
                  Client Revenue Opportunity Brief
                </p>
                <h2 className="mt-5 text-2xl font-semibold">
                  {brief.propertyName || "Property name"}
                </h2>
                <p className="mt-1 text-sm opacity-80">
                  {brief.locationLabel || "City, State"}
                </p>
                <p className="mt-5 text-sm">
                  Prepared for {brief.preparedFor || "owner or prospect"}
                </p>
                <div className="mt-6 flex items-center gap-2 text-xs opacity-80">
                  <ImagePlus />
                  {brief.photoDataUrl ? "Cover photo included" : "Branded cover treatment"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  [brief.metrics.rating || "—", "Rating"],
                  [brief.metrics.reviews || "—", "Reviews"],
                  [brief.metrics.layout || "—", "Layout"],
                  [brief.metrics.guests || "—", "Guests"],
                ].map(([value, label]) => (
                  <Card key={label}>
                    <CardContent className="pt-6 text-center">
                      <p className="text-lg font-semibold">{value}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Executive read</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {brief.executiveSummary}
                </p>
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Demand drivers</p>
                  <Badge variant="secondary">{brief.demandDrivers.length}</Badge>
                </div>
                {brief.demandDrivers.slice(0, 4).map((driver, index) => (
                  <div key={`preview-driver-${index}`} className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm">{driver.name || `Demand driver ${index + 1}`}</p>
                      <p className="text-xs text-muted-foreground">{driver.why || "Why it matters"}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {driver.distance || "—"}
                    </span>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck />
                  <p className="text-sm font-medium">Client-safe evidence boundary</p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Managed-period benchmark lift is presented as supporting evidence, never as a guaranteed
                  revenue projection for this property.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <p className="text-xs text-muted-foreground">
                The output includes the cover, executive summary, property snapshot, demand map,
                revenue plan, benchmarks, and final data request.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
