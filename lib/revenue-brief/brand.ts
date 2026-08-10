import { z } from "zod"

export const REVENUE_BRIEF_BRAND_BUCKET = "revenue-brief-brands"

export const CO_BRANDING_MODES = [
  {
    value: "partner_led",
    label: "Partner-led",
    description:
      "Partner brand leads; RevFactor appears as the revenue strategy provider.",
  },
  {
    value: "co_branded",
    label: "Co-branded",
    description: "Partner and RevFactor are presented together.",
  },
  {
    value: "revfactor_led",
    label: "RevFactor-led",
    description: "RevFactor leads; the partner is acknowledged on the cover.",
  },
] as const

export type CoBrandingMode = (typeof CO_BRANDING_MODES)[number]["value"]

const color = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex color")
const optionalUrl = z.union([z.literal(""), z.url().max(500)])

export const RevenueBriefBrandSaveSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2, "Brand name is required").max(100),
  clientId: z.union([z.literal(""), z.uuid()]),
  coBrandingMode: z.enum(["partner_led", "co_branded", "revfactor_led"]),
  primaryColor: color,
  secondaryColor: color,
  accentColor: color,
  fontFamily: z.string().trim().max(100),
  footerText: z.string().trim().max(180),
  sourceDriveUrl: optionalUrl,
  logoStoragePath: z.string().trim().max(500),
  logoFileName: z.string().trim().max(180),
  manualStoragePath: z.string().trim().max(500),
  manualFileName: z.string().trim().max(180),
})

export type RevenueBriefBrandSaveInput = z.infer<
  typeof RevenueBriefBrandSaveSchema
>

export type RevenueBriefBrandProfile = {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
  coBrandingMode: CoBrandingMode
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontFamily: string | null
  footerText: string | null
  sourceDriveUrl: string | null
  logoStoragePath: string | null
  logoFileName: string | null
  manualStoragePath: string | null
  manualFileName: string | null
  logoUrl: string | null
  manualUrl: string | null
}

export type RevenueBriefBrandTheme = {
  name: string
  coBrandingMode: CoBrandingMode
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontFamily: string | null
  footerText: string | null
  logoDataUrl: string | null
}

export function normalizeHex(value: string): string {
  return value.trim().toUpperCase()
}

export function safeAssetName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() || "bin"
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
  return `${base || "asset"}.${extension}`
}
