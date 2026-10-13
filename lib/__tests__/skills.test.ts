import { describe, expect, it } from "vitest"

import {
  filterSkills,
  getSkillCatalog,
  normalizeSkillCatalog,
  resolveWikiLinks,
  sortSkills,
} from "@/lib/skills"

describe("skills catalog", () => {
  it("loads the committed wikifactor export", () => {
    const catalog = getSkillCatalog()
    expect(catalog.skills.length).toBeGreaterThan(0)
    expect(new Set(catalog.skills.map((s) => s.id)).size).toBe(catalog.skills.length)
  })

  it("drops malformed rows and defaults unknown fields", () => {
    const catalog = normalizeSkillCatalog({
      skills: [
        { id: "Bad Id", name: "x" },
        { id: "ok", name: "OK", statusLevel: "weird", runs: ["a", 1] },
        null,
      ],
    })
    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0]).toMatchObject({
      id: "ok",
      kind: "framework",
      statusLevel: "draft",
      runs: ["a"],
      skillPath: null,
    })
  })

  it("sorts by settledness and filters by text and level", () => {
    const { skills } = normalizeSkillCatalog({
      skills: [
        { id: "b", name: "B", statusLevel: "retired" },
        { id: "a", name: "A", statusLevel: "draft", summary: "floor price" },
        { id: "c", name: "C", statusLevel: "approved" },
      ],
    })
    expect(sortSkills(skills).map((s) => s.id)).toEqual(["c", "a", "b"])
    expect(filterSkills(skills, { q: "FLOOR", kind: null, area: null, level: null })).toHaveLength(1)
    expect(filterSkills(skills, { q: "", kind: null, area: null, level: "approved" })[0].id).toBe("c")
  })

  it("keeps skill links in the Hub and sends other wiki links to wikifactor", () => {
    const out = resolveWikiLinks(
      "See [[skills/ota-markup]] and [[playbooks/comp-analysis|the playbook]].",
      new Set(["ota-markup"])
    )
    expect(out).toContain("[ota-markup](/skills/ota-markup)")
    expect(out).toContain(
      "[the playbook](https://github.com/federzimer/wikifactor/blob/main/playbooks/comp-analysis.md)"
    )
  })
})
