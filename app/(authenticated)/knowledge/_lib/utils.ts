import {
  BookOpen,
  DollarSign,
  MessageSquare,
  ClipboardList,
  Scale,
  Megaphone,
  Briefcase,
  Building2,
  Calendar,
  FileText,
  Globe,
  Headphones,
  Heart,
  Key,
  Lightbulb,
  Lock,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"

export const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen,
  DollarSign,
  MessageSquare,
  ClipboardList,
  Scale,
  Megaphone,
  Briefcase,
  Building2,
  Calendar,
  FileText,
  Globe,
  Headphones,
  Heart,
  Key,
  Lightbulb,
  Lock,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Wrench,
  Zap,
}

export const AVAILABLE_ICONS = Object.keys(ICON_MAP)

export function getCategoryIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? BookOpen
}

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export function htmlToExcerpt(html: string, maxLen = 160): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "..."
}

export function estimateReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  const words = text.split(" ").filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
