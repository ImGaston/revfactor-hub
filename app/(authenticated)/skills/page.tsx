import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { getSkillCatalog, sortSkills, toSkillListItem } from "@/lib/skills"

import { SkillsView } from "./skills-view"

export default async function SkillsPage() {
  const canView = await hasPermission("knowledge", "view")
  if (!canView) redirect("/")

  const catalog = getSkillCatalog()
  return (
    <SkillsView
      skills={sortSkills(catalog.skills.map(toSkillListItem))}
      sourceRevision={catalog.sourceRevision}
    />
  )
}
