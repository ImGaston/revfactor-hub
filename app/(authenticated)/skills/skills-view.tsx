"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ExternalLink, Search, Zap } from "lucide-react"

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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SKILL_STATUS_LEVELS,
  WIKIFACTOR_REPO_URL,
  filterSkills,
  isRunnable,
  statusTone,
  type SkillListItem,
  type SkillStatusLevel,
} from "@/lib/skills"

const ALL = "__all"

export function SkillsView({
  skills,
  sourceRevision,
}: {
  skills: SkillListItem[]
  sourceRevision: string | null
}) {
  const [q, setQ] = useState("")
  const [kind, setKind] = useState<string>(ALL)
  const [area, setArea] = useState<string>(ALL)
  const [level, setLevel] = useState<string>(ALL)

  const kinds = useMemo(() => [...new Set(skills.map((s) => s.kind))].sort(), [skills])
  const areas = useMemo(
    () => [...new Set(skills.map((s) => s.area).filter(Boolean))].sort(),
    [skills]
  )

  const visible = useMemo(
    () =>
      filterSkills(skills, {
        q,
        kind: kind === ALL ? null : kind,
        area: area === ALL ? null : area,
        level: level === ALL ? null : (level as SkillStatusLevel),
      }),
    [skills, q, kind, area, level]
  )
  // Retired skills drop to the bottom unless the user filters for them.
  const active = visible.filter((s) => s.statusLevel !== "retired")
  const retired = visible.filter((s) => s.statusLevel === "retired")
  const approvedCount = skills.filter((s) => s.statusLevel === "approved").length
  const runnableCount = skills.filter(isRunnable).length
  const filtered = q !== "" || kind !== ALL || area !== ALL || level !== ALL

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            RevFactor&apos;s frameworks, rules and runnable AI skills. Wikifactor is the source of
            truth; this page is a read-only copy. {skills.length} skills, {approvedCount} approved
            {runnableCount > 0 ? `, ${runnableCount} runnable` : ""}.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`${WIKIFACTOR_REPO_URL}/tree/main/skills`} target="_blank" rel="noreferrer">
            Edit in wikifactor
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search skills"
            className="pl-8"
            aria-label="Search skills"
          />
        </div>
        <FilterSelect label="Kind" value={kind} onChange={setKind} options={kinds} />
        <FilterSelect label="Area" value={area} onChange={setArea} options={areas} />
        <FilterSelect
          label="Status"
          value={level}
          onChange={setLevel}
          options={[...SKILL_STATUS_LEVELS]}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("")
              setKind(ALL)
              setArea(ALL)
              setLevel(ALL)
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No skills match</EmptyTitle>
            <EmptyDescription>Try a different search or clear the filters.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <SkillGrid skills={active} />
          {retired.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">Retired</h2>
              <SkillGrid skills={retired} />
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Synced from wikifactor{sourceRevision ? ` at ${sourceRevision}` : ""}.
      </p>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="capitalize">
              {o}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function SkillGrid({ skills }: { skills: SkillListItem[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {skills.map((s) => (
        <Link key={s.id} href={`/skills/${s.id}`} className="group">
          <Card className="h-full transition-colors group-hover:bg-muted/40">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={statusTone(s.statusLevel)} className="capitalize">
                  {s.statusLevel}
                </Badge>
                {isRunnable(s) ? (
                  <Badge variant="secondary">
                    <Zap data-icon="inline-start" />
                    Runnable
                  </Badge>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {s.kind}
                  </Badge>
                )}
                {s.area && (
                  <Badge variant="ghost" className="capitalize text-muted-foreground">
                    {s.area}
                  </Badge>
                )}
              </div>
              <CardTitle className="mt-2 text-base">{s.name}</CardTitle>
              {s.whenToUse && (
                <CardDescription className="line-clamp-2">Use when {s.whenToUse}</CardDescription>
              )}
            </CardHeader>
            {s.summary && (
              <CardContent>
                <p className="line-clamp-3 text-sm">{s.summary}</p>
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  )
}
