// Client-safe sidebar navigation catalog + folder (group) tree builder.
//
// Sections are defined here in code (stable `key` per section). How they are
// grouped into collapsible folders and ordered lives in the DB
// (`nav_groups`, `nav_item_settings`, migration 20260915120000) and is
// managed from Settings > Navigation. Permission filtering happens before the
// tree is built, so a section a role cannot view never shows up in a folder.

import { createElement } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Archive,
  BarChart3,
  Bot,
  BookOpen,
  Briefcase,
  Building2,
  Cable,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ClipboardList,
  Compass,
  DollarSign,
  FileChartColumnIncreasing,
  FlaskConical,
  Folder,
  LayoutDashboard,
  Layers,
  Lightbulb,
  Radar,
  Rocket,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Users,
  Wrench,
  Zap,
} from "lucide-react"

export type NavItem = {
  /** Stable identifier persisted in `nav_item_settings.item_key`. Never rename. */
  key: string
  title: string
  href: string
  icon: LucideIcon
  /** `${resource}:view` permission required to see the section. */
  resource?: string
  superAdminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", title: "Dashboard", href: "/", icon: LayoutDashboard },
  { key: "clients", title: "Clients", href: "/clients", icon: Users, resource: "clients" },
  { key: "listings", title: "Listings", href: "/listings", icon: Building2, resource: "listings" },
  {
    key: "monthly-summary",
    title: "Monthly Summary",
    href: "/monthly-summary",
    icon: CalendarRange,
    resource: "monthly_summary",
  },
  {
    key: "reservations",
    title: "Reservations",
    href: "/reservations",
    icon: CalendarCheck,
    resource: "reservations",
  },
  { key: "tasks", title: "Tasks", href: "/tasks", icon: CheckSquare, resource: "tasks" },
  {
    key: "adjustments",
    title: "Adjustments",
    href: "/adjustments",
    icon: SlidersHorizontal,
    resource: "adjustments",
  },
  { key: "wins", title: "Wins", href: "/wins", icon: Trophy, resource: "wins" },
  {
    key: "onboarding",
    title: "Onboarding",
    href: "/onboarding",
    icon: ClipboardList,
    resource: "onboarding",
  },
  {
    key: "roadmap",
    title: "Projects & Roadmap",
    href: "/roadmap",
    icon: Lightbulb,
    resource: "roadmap",
  },
  { key: "ghl", title: "GHL", href: "/ghl", icon: Cable, resource: "ghl" },
  {
    key: "revenue-briefs",
    title: "Revenue Briefs",
    href: "/revenue-briefs",
    icon: FileChartColumnIncreasing,
    resource: "ghl",
  },
  { key: "knowledge", title: "Knowledge", href: "/knowledge", icon: BookOpen, resource: "knowledge" },
  {
    key: "agent-studio",
    title: "Agent Studio",
    href: "/agent-studio",
    icon: Bot,
    resource: "agent_studio",
  },
  {
    key: "revenue-manager",
    title: "Revenue Manager",
    href: "/revenue-manager",
    icon: TrendingUp,
    resource: "revenue",
  },
  {
    key: "market-signals",
    title: "Market Signals",
    href: "/market-signals",
    icon: Radar,
    resource: "market_signals",
  },
  {
    key: "financials",
    title: "Financials",
    href: "/financials",
    icon: DollarSign,
    superAdminOnly: true,
  },
]

export function isNavItemActive(item: Pick<NavItem, "href">, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
}

// ---------------------------------------------------------------------------
// Folder icons — a curated, name-keyed set so the DB stores a plain string.
// ---------------------------------------------------------------------------

export const NAV_GROUP_ICONS = {
  folder: Folder,
  flask: FlaskConical,
  sparkles: Sparkles,
  star: Star,
  rocket: Rocket,
  zap: Zap,
  layers: Layers,
  briefcase: Briefcase,
  calendar: CalendarDays,
  chart: BarChart3,
  compass: Compass,
  shield: Shield,
  wrench: Wrench,
  archive: Archive,
} satisfies Record<string, LucideIcon>

export type NavGroupIconName = keyof typeof NAV_GROUP_ICONS

export const NAV_GROUP_ICON_OPTIONS: { value: NavGroupIconName; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "flask", label: "Flask (beta / experiments)" },
  { value: "sparkles", label: "Sparkles" },
  { value: "star", label: "Star" },
  { value: "rocket", label: "Rocket" },
  { value: "zap", label: "Zap" },
  { value: "layers", label: "Layers" },
  { value: "briefcase", label: "Briefcase" },
  { value: "calendar", label: "Calendar" },
  { value: "chart", label: "Chart" },
  { value: "compass", label: "Compass" },
  { value: "shield", label: "Shield" },
  { value: "wrench", label: "Wrench" },
  { value: "archive", label: "Archive" },
]

export function isNavGroupIconName(value: string): value is NavGroupIconName {
  return Object.prototype.hasOwnProperty.call(NAV_GROUP_ICONS, value)
}

export function getNavGroupIcon(name: string): LucideIcon {
  return isNavGroupIconName(name) ? NAV_GROUP_ICONS[name] : Folder
}

/** Renders a folder icon by name (avoids creating components during render). */
export function NavGroupIcon({ name, className }: { name: string; className?: string }) {
  return createElement(getNavGroupIcon(name), { className })
}

// ---------------------------------------------------------------------------
// Persisted config + tree
// ---------------------------------------------------------------------------

export type NavGroup = {
  id: string
  label: string
  icon: string
  sort_order: number
  default_collapsed: boolean
}

export type NavItemSetting = {
  item_key: string
  group_id: string | null
  sort_order: number
}

export type NavConfig = {
  groups: NavGroup[]
  items: NavItemSetting[]
}

export const EMPTY_NAV_CONFIG: NavConfig = { groups: [], items: [] }

export type NavTreeGroup = {
  group: NavGroup
  items: NavItem[]
}

export type NavTree = {
  /** Sections not filed in any folder, in code order. */
  topLevel: NavItem[]
  /** Folders in `sort_order`, each with its sections in `sort_order`. */
  groups: NavTreeGroup[]
}

/**
 * Pure: arrange `items` (already permission-filtered) into top-level entries
 * and folders according to `config`. A section pointing at a folder that no
 * longer exists falls back to the top level. Folders with no (visible)
 * sections are dropped unless `includeEmptyGroups` is set — the sidebar hides
 * them, the settings manager shows them.
 */
export function buildNavTree(
  items: NavItem[],
  config: NavConfig,
  options: { includeEmptyGroups?: boolean } = {}
): NavTree {
  const groups = [...config.groups].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  )
  const groupIds = new Set(groups.map((g) => g.id))
  const settingByKey = new Map(config.items.map((s) => [s.item_key, s]))

  const topLevel: NavItem[] = []
  const grouped = new Map<string, { item: NavItem; order: number; index: number }[]>()

  items.forEach((item, index) => {
    const setting = settingByKey.get(item.key)
    const groupId = setting?.group_id ?? null
    if (groupId && groupIds.has(groupId)) {
      const bucket = grouped.get(groupId) ?? []
      bucket.push({ item, order: setting?.sort_order ?? 0, index })
      grouped.set(groupId, bucket)
    } else {
      topLevel.push(item)
    }
  })

  const treeGroups: NavTreeGroup[] = []
  for (const group of groups) {
    const bucket = grouped.get(group.id) ?? []
    if (bucket.length === 0 && !options.includeEmptyGroups) continue
    bucket.sort((a, b) => a.order - b.order || a.index - b.index)
    treeGroups.push({ group, items: bucket.map((b) => b.item) })
  }

  return { topLevel, groups: treeGroups }
}
