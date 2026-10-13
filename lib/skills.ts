// Client-safe RevFactor skills catalog.
//
// Wikifactor (federzimer/wikifactor) is the source of truth for skills. Its
// `tools/brain/export_skills.py` writes `exports/pricing-skills.json`; the Hub
// keeps a committed copy at `data/wikifactor/skills.json`, refreshed with
// `scripts/sync-wikifactor-skills.sh`. The Hub only reads it — edits happen in
// wikifactor.

import rawCatalog from "@/data/wikifactor/skills.json"

export const WIKIFACTOR_REPO_URL = "https://github.com/federzimer/wikifactor"

/** Settledness levels, most settled first. Mirrors LEVELS in export_skills.py. */
export const SKILL_STATUS_LEVELS = [
  "approved",
  "team decision",
  "design rule",
  "stated in meetings",
  "draft",
  "needs review",
  "retired",
] as const

export type SkillStatusLevel = (typeof SKILL_STATUS_LEVELS)[number]

export type SkillSection = { title: string; markdown: string }

export type Skill = {
  id: string
  name: string
  /** framework | rule | skill | runnable (runnable = an executable AI skill). */
  kind: string
  area: string
  status: string
  statusLevel: SkillStatusLevel
  owner: string
  channels: string
  tools: string
  whenToUse: string
  summary: string
  sections: SkillSection[]
  /** Path of the page in wikifactor, e.g. `skills/ota-markup.md`. */
  path: string
  /** Runnable skills: ids of the framework pages this skill executes. */
  runs: string[]
  /** Runnable skills: path of the SKILL.md in wikifactor. */
  skillPath: string | null
}

/** List views render no sections; keep the client payload trimmed. */
export type SkillListItem = Omit<Skill, "sections">

export function toSkillListItem(skill: Skill): SkillListItem {
  const item: Partial<Skill> = { ...skill }
  delete item.sections
  return item as SkillListItem
}

export type SkillCatalog = {
  source: string
  sourceRevision: string | null
  skills: Skill[]
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

function isStatusLevel(v: string): v is SkillStatusLevel {
  return (SKILL_STATUS_LEVELS as readonly string[]).includes(v)
}

/** Defensive normalizer: unknown fields are optional, malformed rows are dropped. */
export function normalizeSkillCatalog(raw: unknown): SkillCatalog {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const rows = Array.isArray(obj.skills) ? obj.skills : []
  const skills: Skill[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const id = str(r.id)
    const name = str(r.name)
    if (!/^[a-z0-9-]+$/.test(id) || !name) continue
    const level = str(r.statusLevel).toLowerCase()
    skills.push({
      id,
      name,
      kind: str(r.kind) || "framework",
      area: str(r.area),
      status: str(r.status),
      statusLevel: isStatusLevel(level) ? level : "draft",
      owner: str(r.owner),
      channels: str(r.channels),
      tools: str(r.tools),
      whenToUse: str(r.whenToUse),
      summary: str(r.summary),
      sections: (Array.isArray(r.sections) ? r.sections : [])
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .map((s) => ({ title: str(s.title), markdown: str(s.markdown) }))
        .filter((s) => s.title || s.markdown),
      path: str(r.path),
      runs: (Array.isArray(r.runs) ? r.runs : []).filter(
        (v): v is string => typeof v === "string"
      ),
      skillPath: str(r.skillPath) || null,
    })
  }
  return {
    source: str(obj.source) || "wikifactor skills/",
    sourceRevision: str(obj.sourceRevision) || null,
    skills,
  }
}

let cached: SkillCatalog | null = null

export function getSkillCatalog(): SkillCatalog {
  cached ??= normalizeSkillCatalog(rawCatalog)
  return cached
}

export function getSkill(id: string): Skill | null {
  return getSkillCatalog().skills.find((s) => s.id === id) ?? null
}

export function isRunnable(skill: SkillListItem): boolean {
  return skill.kind === "runnable"
}

/** Sort: active before retired, then by settledness, then by name. */
export function sortSkills<T extends SkillListItem>(skills: T[]): T[] {
  return [...skills].sort(
    (a, b) =>
      SKILL_STATUS_LEVELS.indexOf(a.statusLevel) - SKILL_STATUS_LEVELS.indexOf(b.statusLevel) ||
      a.name.localeCompare(b.name)
  )
}

export type SkillFilters = {
  q: string
  kind: string | null
  area: string | null
  level: SkillStatusLevel | null
}

export function filterSkills<T extends SkillListItem>(skills: T[], f: SkillFilters): T[] {
  const q = f.q.trim().toLowerCase()
  return skills.filter((s) => {
    if (f.kind && s.kind !== f.kind) return false
    if (f.area && s.area !== f.area) return false
    if (f.level && s.statusLevel !== f.level) return false
    if (!q) return true
    return [s.name, s.summary, s.whenToUse, s.area, s.id].some((v) =>
      v.toLowerCase().includes(q)
    )
  })
}

/** Badge tone per settledness level. */
export function statusTone(
  level: SkillStatusLevel
): "default" | "secondary" | "outline" | "destructive" {
  if (level === "approved") return "default"
  if (level === "team decision" || level === "design rule") return "secondary"
  if (level === "needs review") return "destructive"
  return "outline"
}

export function wikifactorUrl(path: string): string {
  return `${WIKIFACTOR_REPO_URL}/blob/main/${path.replace(/^\/+/, "")}`
}

/**
 * Turns Obsidian `[[target|label]]` links into markdown links. Links to other
 * skill pages stay in the Hub; everything else opens the wikifactor page.
 */
export function resolveWikiLinks(markdown: string, knownSkillIds: Set<string>): string {
  return markdown.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => {
    const t = target.trim()
    const text = (label ?? t.split("/").pop() ?? t).trim()
    const skillId = t.startsWith("skills/") ? t.slice("skills/".length) : null
    if (skillId && knownSkillIds.has(skillId)) return `[${text}](/skills/${skillId})`
    return `[${text}](${wikifactorUrl(`${t}.md`)})`
  })
}
