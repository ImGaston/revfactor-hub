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

/** Runnable skills climb their own ladder. Mirrors STAGES in export_catalog.py. */
export const RUNNABLE_STAGES = [
  "missing",
  "draft",
  "tested on 1",
  "tested on 5",
  "approved",
  "pipeline",
  "retired",
] as const

export type RunnableStage = (typeof RUNNABLE_STAGES)[number]

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
  /** Runnable skills: stage text and its ladder level. */
  stage: string
  stageLevel: RunnableStage | null
  runsOn: string
  modelTier: string
  source: string
  /** Runnable skills: wikifactor pages (framework or playbook) it implements. */
  implementsPaths: string[]
  roadmapIds: string[]
  /** Runnable skills: whether the SKILL.md is in wikifactor. */
  inRepo: boolean
  /** Runnable skills: the full SKILL.md text, when it is in the repo. */
  skillMarkdown: string | null
  /** Framework pages: runnable skills that execute this page. */
  runnableIds: string[]
}

/** List views render neither sections nor SKILL.md text; keep the client payload trimmed. */
export type SkillListItem = Omit<Skill, "sections" | "skillMarkdown">

export function toSkillListItem(skill: Skill): SkillListItem {
  const item: Partial<Skill> = { ...skill }
  delete item.sections
  delete item.skillMarkdown
  return item as SkillListItem
}

/** One roadmap item and the skills or pages it still needs. */
export type SkillRoadmapItem = {
  id: string
  item: string
  playbook: string | null
  needs: string[]
}

export type SkillCatalog = {
  source: string
  sourceRevision: string | null
  skills: Skill[]
  roadmap: SkillRoadmapItem[]
}

const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x !== "")

function isRunnableStage(v: string): v is RunnableStage {
  return (RUNNABLE_STAGES as readonly string[]).includes(v)
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
      runs: strList(r.runs),
      skillPath: str(r.skillPath) || null,
      stage: str(r.stage),
      stageLevel: isRunnableStage(str(r.stageLevel)) ? (str(r.stageLevel) as RunnableStage) : null,
      runsOn: str(r.runsOn),
      modelTier: str(r.modelTier),
      source: str(r.source),
      implementsPaths: strList(r.implementsPaths),
      roadmapIds: strList(r.roadmapIds),
      inRepo: r.inRepo === true,
      skillMarkdown: str(r.skillMarkdown) || null,
      runnableIds: strList(r.runnableIds),
    })
  }
  const roadmap: SkillRoadmapItem[] = []
  for (const row of Array.isArray(obj.roadmap) ? obj.roadmap : []) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    if (!str(r.id) || !str(r.item)) continue
    roadmap.push({
      id: str(r.id),
      item: str(r.item),
      playbook: str(r.playbook) || null,
      needs: strList(r.needs),
    })
  }
  return {
    source: str(obj.source) || "wikifactor skills/",
    sourceRevision: str(obj.sourceRevision) || null,
    skills,
    roadmap,
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

/** Badge tone per runnable stage. */
export function stageTone(
  stage: RunnableStage | null
): "default" | "secondary" | "outline" | "destructive" {
  if (stage === "approved" || stage === "pipeline") return "default"
  if (stage === "tested on 1" || stage === "tested on 5") return "secondary"
  if (stage === "missing") return "destructive"
  return "outline"
}

/** In-Hub link for skill pages, wikifactor link for everything else. */
export function wikiPageHref(path: string, knownSkillIds: Set<string>): string {
  const id = path.startsWith("skills/") ? path.slice("skills/".length) : null
  return id && knownSkillIds.has(id) ? `/skills/${id}` : wikifactorUrl(`${path}.md`)
}

/** Drops a leading YAML frontmatter block from a SKILL.md. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "")
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
