// Pastel color palettes for categories
export const CATEGORY_COLORS = {
  mint: {
    bg: "bg-emerald-50",
    dark: "dark:bg-emerald-950/30",
    accent: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  },
  peach: {
    bg: "bg-orange-50",
    dark: "dark:bg-orange-950/30",
    accent: "text-orange-600 dark:text-orange-400",
    border: "border-orange-200 dark:border-orange-800",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  },
  lavender: {
    bg: "bg-violet-50",
    dark: "dark:bg-violet-950/30",
    accent: "text-violet-600 dark:text-violet-400",
    border: "border-violet-200 dark:border-violet-800",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  },
  sky: {
    bg: "bg-sky-50",
    dark: "dark:bg-sky-950/30",
    accent: "text-sky-600 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-800",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  },
  rose: {
    bg: "bg-rose-50",
    dark: "dark:bg-rose-950/30",
    accent: "text-rose-600 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-800",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  },
  amber: {
    bg: "bg-amber-50",
    dark: "dark:bg-amber-950/30",
    accent: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  },
} as const

export type CategoryColorKey = keyof typeof CATEGORY_COLORS

// Tag colors
export const TAG_COLORS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
}
