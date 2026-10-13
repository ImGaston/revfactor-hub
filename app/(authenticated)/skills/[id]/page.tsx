import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ExternalLink, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { hasPermission } from "@/lib/permissions.server"
import {
  getSkill,
  getSkillCatalog,
  isRunnable,
  stripFrontmatter,
  wikifactorUrl,
} from "@/lib/skills"

import { SkillMarkdown } from "../skill-markdown"
import { SkillLevelBadge, WikiPageBadge } from "../skills-view"

type Props = { params: Promise<{ id: string }> }

export default async function SkillDetailPage({ params }: Props) {
  const canView = await hasPermission("knowledge", "view")
  if (!canView) redirect("/")

  const { id } = await params
  const skill = getSkill(id)
  if (!skill) notFound()

  const catalog = getSkillCatalog()
  const knownIds = catalog.skills.map((s) => s.id)
  const knownIdSet = new Set(knownIds)
  const byId = new Map(catalog.skills.map((s) => [s.id, s]))
  // Runnable skills point at the frameworks they execute; frameworks list
  // the runnable skills that execute them.
  const runs = skill.runs.map((r) => byId.get(r)).filter((s) => s !== undefined)
  const runBy = catalog.skills.filter(
    (s) => s.runs.includes(skill.id) || skill.runnableIds.includes(s.id)
  )
  const roadmapItems = catalog.roadmap.filter((r) => skill.roadmapIds.includes(r.id))
  // Playbooks and other pages it implements that are not already linked as frameworks.
  const otherPages = skill.implementsPaths.filter(
    (p) => !runs.some((r) => p === `skills/${r.id}`)
  )

  const facts = (
    isRunnable(skill)
      ? [
          ["Stage", skill.stage],
          ["Runs on", skill.runsOn],
          ["Model tier", skill.modelTier],
          ["Source", skill.source],
          ["Roadmap", roadmapItems.map((r) => r.item).join("; ")],
        ]
      : [
          ["Use when", skill.whenToUse],
          ["Owner", skill.owner],
          ["Channels", skill.channels],
          ["Tools", skill.tools],
          ["Status", skill.status],
        ]
  ).filter(([, v]) => v)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link href="/skills">
          <ArrowLeft data-icon="inline-start" />
          Skills
        </Link>
      </Button>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <SkillLevelBadge skill={skill} />
          {isRunnable(skill) ? (
            <Badge variant="secondary">
              <Zap data-icon="inline-start" />
              Runnable
            </Badge>
          ) : (
            <Badge variant="outline" className="capitalize">
              {skill.kind}
            </Badge>
          )}
          {skill.area && (
            <Badge variant="ghost" className="capitalize text-muted-foreground">
              {skill.area}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
          <Button variant="outline" size="sm" asChild>
            <a href={wikifactorUrl(skill.skillPath ?? skill.path)} target="_blank" rel="noreferrer">
              Open in wikifactor
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        </div>
        {skill.summary && <p className="text-muted-foreground">{skill.summary}</p>}
      </div>

      {facts.length > 0 && (
        <Card>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="font-medium text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {(runs.length > 0 || runBy.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {runs.length > 0 ? "Runs the framework" : "Run by"}
          </span>
          {(runs.length > 0 ? runs : runBy).map((s) => (
            <Badge key={s.id} variant="outline" asChild>
              <Link href={`/skills/${s.id}`}>{s.name}</Link>
            </Badge>
          ))}
        </div>
      )}

      {otherPages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Implements</span>
          {otherPages.map((p) => (
            <WikiPageBadge key={p} path={p} knownIds={knownIdSet} />
          ))}
        </div>
      )}

      {skill.sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <SkillMarkdown markdown={section.markdown} knownSkillIds={knownIds} />
          </CardContent>
        </Card>
      ))}

      {isRunnable(skill) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SKILL.md</CardTitle>
          </CardHeader>
          <CardContent>
            {skill.skillMarkdown ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Show the full skill instructions
                </summary>
                <div className="mt-4">
                  <SkillMarkdown
                    markdown={stripFrontmatter(skill.skillMarkdown)}
                    knownSkillIds={knownIds}
                  />
                </div>
              </details>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not in wikifactor yet{skill.source ? `: ${skill.source}` : "."}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
