// Category color presets — each preset maps to the 3 DB color fields
// (color, dark_color, accent_color). Users pick a preset name, not raw classes.

export type CategoryColorPreset = {
  key: string
  label: string
  color: string
  dark_color: string
  accent_color: string
  swatch: string // for UI picker
}

export const CATEGORY_COLOR_PRESETS: CategoryColorPreset[] = [
  {
    key: "emerald",
    label: "Mint",
    color: "bg-emerald-50",
    dark_color: "dark:bg-emerald-950/30",
    accent_color: "text-emerald-600 dark:text-emerald-400",
    swatch: "bg-emerald-400",
  },
  {
    key: "orange",
    label: "Peach",
    color: "bg-orange-50",
    dark_color: "dark:bg-orange-950/30",
    accent_color: "text-orange-600 dark:text-orange-400",
    swatch: "bg-orange-400",
  },
  {
    key: "violet",
    label: "Lavender",
    color: "bg-violet-50",
    dark_color: "dark:bg-violet-950/30",
    accent_color: "text-violet-600 dark:text-violet-400",
    swatch: "bg-violet-400",
  },
  {
    key: "sky",
    label: "Sky",
    color: "bg-sky-50",
    dark_color: "dark:bg-sky-950/30",
    accent_color: "text-sky-600 dark:text-sky-400",
    swatch: "bg-sky-400",
  },
  {
    key: "rose",
    label: "Rose",
    color: "bg-rose-50",
    dark_color: "dark:bg-rose-950/30",
    accent_color: "text-rose-600 dark:text-rose-400",
    swatch: "bg-rose-400",
  },
  {
    key: "amber",
    label: "Amber",
    color: "bg-amber-50",
    dark_color: "dark:bg-amber-950/30",
    accent_color: "text-amber-600 dark:text-amber-400",
    swatch: "bg-amber-400",
  },
  {
    key: "teal",
    label: "Teal",
    color: "bg-teal-50",
    dark_color: "dark:bg-teal-950/30",
    accent_color: "text-teal-600 dark:text-teal-400",
    swatch: "bg-teal-400",
  },
  {
    key: "pink",
    label: "Pink",
    color: "bg-pink-50",
    dark_color: "dark:bg-pink-950/30",
    accent_color: "text-pink-600 dark:text-pink-400",
    swatch: "bg-pink-400",
  },
]

/** Find the preset that matches an existing category's color fields. */
export function findPresetByColor(color: string): CategoryColorPreset {
  return (
    CATEGORY_COLOR_PRESETS.find((p) => p.color === color) ??
    CATEGORY_COLOR_PRESETS[0]
  )
}
