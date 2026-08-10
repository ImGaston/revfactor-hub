"use client"

import { useMemo, useState } from "react"
import NextImage from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  BookOpen,
  ImageIcon,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  CO_BRANDING_MODES,
  REVENUE_BRIEF_BRAND_BUCKET,
  RevenueBriefBrandSaveSchema,
  safeAssetName,
  type RevenueBriefBrandProfile,
  type RevenueBriefBrandSaveInput,
} from "@/lib/revenue-brief/brand"
import { createClient } from "@/lib/supabase/client"
import { deleteRevenueBriefBrand, saveRevenueBriefBrand } from "./actions"

type ClientOption = { id: string; name: string }

const NEW_BRAND = (): RevenueBriefBrandSaveInput => ({
  id: crypto.randomUUID(),
  name: "",
  clientId: "",
  coBrandingMode: "co_branded",
  primaryColor: "#173F35",
  secondaryColor: "#405542",
  accentColor: "#95543D",
  fontFamily: "",
  footerText: "",
  sourceDriveUrl: "",
  logoStoragePath: "",
  logoFileName: "",
  manualStoragePath: "",
  manualFileName: "",
})

const MINTED_STAY_EXAMPLE = (): RevenueBriefBrandSaveInput => ({
  ...NEW_BRAND(),
  name: "MintedStay",
  coBrandingMode: "partner_led",
  primaryColor: "#000000",
  secondaryColor: "#CADB84",
  accentColor: "#CADB84",
  fontFamily: "Museo Sans 700",
  footerText: "MintedStay · Revenue strategy powered by RevFactor",
  sourceDriveUrl:
    "https://drive.google.com/drive/folders/1hmoN5ah2nUKi-YkzrG4O8w4lx11F5Tjg",
})

function editInput(
  brand: RevenueBriefBrandProfile
): RevenueBriefBrandSaveInput {
  return {
    id: brand.id,
    name: brand.name,
    clientId: brand.clientId ?? "",
    coBrandingMode: brand.coBrandingMode,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    accentColor: brand.accentColor,
    fontFamily: brand.fontFamily ?? "",
    footerText: brand.footerText ?? "",
    sourceDriveUrl: brand.sourceDriveUrl ?? "",
    logoStoragePath: brand.logoStoragePath ?? "",
    logoFileName: brand.logoFileName ?? "",
    manualStoragePath: brand.manualStoragePath ?? "",
    manualFileName: brand.manualFileName ?? "",
  }
}

export function RevenueBriefBrandManager({
  brands,
  clients,
}: {
  brands: RevenueBriefBrandProfile[]
  clients: ClientOption[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<RevenueBriefBrandSaveInput | null>(null)
  const [logo, setLogo] = useState<File | null>(null)
  const [manual, setManual] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const currentBrand = useMemo(
    () => brands.find((brand) => brand.id === draft?.id) ?? null,
    [brands, draft?.id]
  )

  function update<K extends keyof RevenueBriefBrandSaveInput>(
    key: K,
    value: RevenueBriefBrandSaveInput[K]
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function closeDialog() {
    if (saving) return
    setDraft(null)
    setLogo(null)
    setManual(null)
  }

  async function uploadAsset(
    file: File,
    brandId: string,
    kind: "logo" | "manual"
  ) {
    const supabase = createClient()
    const path = `${brandId}/${kind}-${Date.now()}-${safeAssetName(file.name)}`
    const { error } = await supabase.storage
      .from(REVENUE_BRIEF_BRAND_BUCKET)
      .upload(path, file)
    if (error)
      throw new Error(
        `${kind === "logo" ? "Logo" : "Brand manual"} upload failed: ${error.message}`
      )
    return path
  }

  async function handleSave() {
    if (!draft) return
    if (logo && !["image/png", "image/jpeg"].includes(logo.type)) {
      toast.error("The logo must be a PNG or JPG")
      return
    }
    if (logo && logo.size > 2 * 1024 * 1024) {
      toast.error("The logo must be under 2 MB")
      return
    }
    if (manual && manual.type !== "application/pdf") {
      toast.error("The brand manual must be a PDF")
      return
    }
    if (manual && manual.size > 10 * 1024 * 1024) {
      toast.error("The brand manual must be under 10 MB")
      return
    }
    if (
      draft.coBrandingMode !== "revfactor_led" &&
      !draft.logoStoragePath &&
      !logo
    ) {
      toast.error("Upload an approved logo for partner-led or co-branded PDFs")
      return
    }

    const parsed = RevenueBriefBrandSaveSchema.safeParse(draft)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Review the brand profile")
      return
    }

    setSaving(true)
    const uploaded: string[] = []
    try {
      const next = { ...parsed.data }
      if (logo) {
        next.logoStoragePath = await uploadAsset(logo, next.id, "logo")
        next.logoFileName = logo.name
        uploaded.push(next.logoStoragePath)
      }
      if (manual) {
        next.manualStoragePath = await uploadAsset(manual, next.id, "manual")
        next.manualFileName = manual.name
        uploaded.push(next.manualStoragePath)
      }

      const result = await saveRevenueBriefBrand(next)
      if (result.error) throw new Error(result.error)

      toast.success("Brand profile saved")
      setDraft(null)
      setLogo(null)
      setManual(null)
      router.refresh()
    } catch (error) {
      if (uploaded.length > 0) {
        await createClient()
          .storage.from(REVENUE_BRIEF_BRAND_BUCKET)
          .remove(uploaded)
      }
      toast.error(
        error instanceof Error
          ? error.message
          : "The brand profile could not be saved"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteRevenueBriefBrand(id)
    if (result.error) toast.error(result.error)
    else {
      toast.success("Brand profile deleted")
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
            <Link href="/revenue-briefs">
              <ArrowLeft data-icon="inline-start" />
              Revenue Briefs
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Partner brand profiles
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Store each property-management partner&apos;s brand manual, approved
            logo, colors, and co-branding mode once, then reuse them in owner
            proposals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft(MINTED_STAY_EXAMPLE())}
          >
            <Sparkles data-icon="inline-start" />
            MintedStay example
          </Button>
          <Button onClick={() => setDraft(NEW_BRAND())}>
            <Plus data-icon="inline-start" />
            Add brand profile
          </Button>
        </div>
      </div>

      {brands.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No brand profiles yet</CardTitle>
            <CardDescription>
              Add the first property-management partner brand to make it
              available in the Revenue Brief Builder.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                    style={{ backgroundColor: brand.primaryColor }}
                  >
                    {brand.logoUrl ? (
                      <NextImage
                        src={brand.logoUrl}
                        alt={`${brand.name} logo`}
                        className="max-h-10 max-w-12 object-contain"
                        height={40}
                        width={48}
                        unoptimized
                      />
                    ) : (
                      <ImageIcon className="size-5 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{brand.name}</CardTitle>
                    <CardDescription>
                      {brand.clientName || "Not linked to a Hub client"}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline">
                  {
                    CO_BRANDING_MODES.find(
                      (mode) => mode.value === brand.coBrandingMode
                    )?.label
                  }
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  {[
                    brand.primaryColor,
                    brand.secondaryColor,
                    brand.accentColor,
                  ].map((color) => (
                    <span
                      key={color}
                      className="size-7 rounded-full border"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                  <span className="text-sm text-muted-foreground">
                    {brand.fontFamily || "Default PDF typography"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {brand.manualUrl ? (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={brand.manualUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <BookOpen data-icon="inline-start" />
                        Open manual
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="secondary">No manual uploaded</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft(editInput(brand))}
                  >
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost">
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete {brand.name}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the saved profile, logo, and brand
                          manual. Existing downloaded PDFs are unaffected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(brand.id)}
                        >
                          Delete brand
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {currentBrand ? `Edit ${currentBrand.name}` : "Add brand profile"}
            </DialogTitle>
            <DialogDescription>
              Upload the source manual, then normalize the fields the PDF
              renderer should use.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="brand-name">Brand name</FieldLabel>
                  <Input
                    id="brand-name"
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="Minted Stay"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="brand-client">Hub client</FieldLabel>
                  <Select
                    value={draft.clientId || "none"}
                    onValueChange={(value) =>
                      update("clientId", value === "none" ? "" : value)
                    }
                  >
                    <SelectTrigger id="brand-client">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="co-branding-mode">
                  PDF branding mode
                </FieldLabel>
                <Select
                  value={draft.coBrandingMode}
                  onValueChange={(value) =>
                    update(
                      "coBrandingMode",
                      value as RevenueBriefBrandSaveInput["coBrandingMode"]
                    )
                  }
                >
                  <SelectTrigger id="co-branding-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CO_BRANDING_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {
                    CO_BRANDING_MODES.find(
                      (mode) => mode.value === draft.coBrandingMode
                    )?.description
                  }
                </FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["primaryColor", "Primary"],
                    ["secondaryColor", "Secondary"],
                    ["accentColor", "Accent"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={key}>{label}</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id={key}
                        type="color"
                        className="w-12 px-1"
                        value={draft[key]}
                        onChange={(event) => update(key, event.target.value)}
                      />
                      <Input
                        value={draft[key]}
                        onChange={(event) => update(key, event.target.value)}
                        maxLength={7}
                      />
                    </div>
                  </Field>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="font-family">
                    Typography guidance
                  </FieldLabel>
                  <Input
                    id="font-family"
                    value={draft.fontFamily}
                    onChange={(event) =>
                      update("fontFamily", event.target.value)
                    }
                    placeholder="Museo Sans 700"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="footer-text">Footer text</FieldLabel>
                  <Input
                    id="footer-text"
                    value={draft.footerText}
                    onChange={(event) =>
                      update("footerText", event.target.value)
                    }
                    placeholder="Revenue strategy powered by RevFactor"
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="source-drive-url">
                  Source brand folder
                </FieldLabel>
                <Input
                  id="source-drive-url"
                  type="url"
                  value={draft.sourceDriveUrl}
                  onChange={(event) =>
                    update("sourceDriveUrl", event.target.value)
                  }
                  placeholder="https://drive.google.com/drive/folders/..."
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="brand-logo">Approved logo</FieldLabel>
                  <Input
                    id="brand-logo"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(event) =>
                      setLogo(event.target.files?.[0] ?? null)
                    }
                  />
                  <FieldDescription>
                    PNG or JPG, up to 2 MB. {logo?.name || draft.logoFileName}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="brand-manual">Brand manual</FieldLabel>
                  <Input
                    id="brand-manual"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) =>
                      setManual(event.target.files?.[0] ?? null)
                    }
                  />
                  <FieldDescription>
                    PDF, up to 10 MB. {manual?.name || draft.manualFileName}
                  </FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {saving ? "Saving..." : "Save brand profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
