import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Structural guarantees about what the Wins feature is allowed to touch.
//
// These are cheap to run and catch the regression that matters most: someone
// wiring a "send" button into a feature that is specified to be read-only with
// respect to Assembly. A code review can miss that; this cannot.

const ROOT = process.cwd()

function filesUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const rel = path.join(dir, entry)
    return statSync(path.join(ROOT, rel)).isDirectory() ? filesUnder(rel) : [rel]
  })
}

const WINS_FILES = [
  ...filesUnder("app/(authenticated)/wins"),
  "lib/wins.ts",
  "lib/wins-message.ts",
  "lib/wins-detection.server.ts",
  "lib/wins-queries.ts",
].filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))

const SOURCES = WINS_FILES.map((f) => ({
  file: f,
  content: readFileSync(path.join(ROOT, f), "utf8"),
}))

describe("the Wins feature is read-only with respect to Assembly", () => {
  it("collects the expected source files", () => {
    // Guards the guard: if the glob silently returned nothing, every
    // assertion below would vacuously pass.
    expect(WINS_FILES.length).toBeGreaterThanOrEqual(8)
  })

  it("never calls an Assembly write function", () => {
    const forbidden = [
      "sendAssemblyMessage",
      "createAssemblyClient",
      "createAssemblyContract",
      "createAssemblyLink",
      "createAssemblyFileEntry",
      "getOrCreateMessageChannel",
      "createIndividualMessageChannel",
    ]
    for (const { file, content } of SOURCES) {
      for (const fn of forbidden) {
        expect(content, `${file} must not call ${fn}`).not.toContain(fn)
      }
    }
  })

  it("never imports the Assembly API client", () => {
    // The deep-link helper is reimplemented in lib/wins.ts as a pure function
    // precisely so this module boundary can stay closed.
    for (const { file, content } of SOURCES) {
      expect(content, `${file} must not import lib/assembly`).not.toMatch(
        /from "@\/lib\/assembly"/
      )
    }
  })

  it("never posts to the Assembly API", () => {
    for (const { file, content } of SOURCES) {
      expect(content, `${file} must not reach api.assembly.com`).not.toContain(
        "api.assembly.com"
      )
    }
  })

  it("never reads the Assembly API key", () => {
    for (const { file, content } of SOURCES) {
      expect(content, `${file} must not read ASSEMBLY_API_KEY`).not.toContain(
        "ASSEMBLY_API_KEY"
      )
    }
  })
})

describe("copying and opening are never presented as sending", () => {
  it("does not describe any action as sent or delivered to the client", () => {
    const claims = [
      "message sent",
      "sent to client",
      "sent to the client",
      "successfully sent",
      "delivered to",
    ]
    for (const { file, content } of SOURCES) {
      const lower = content.toLowerCase()
      for (const claim of claims) {
        expect(lower, `${file} must not claim "${claim}"`).not.toContain(claim)
      }
    }
  })

  it("routes marked_shared through its own explicit action", () => {
    const actions = SOURCES.find((s) => s.file.endsWith("wins/actions.ts"))!.content
    // recordWinEventAction is the generic event writer and must refuse the one
    // event type that asserts a human shared the message.
    expect(actions).toContain("Use markWinSharedAction to record a manual share")
    expect(actions).toContain("markWinSharedAction")
  })

  it("gates the Assembly deep link on wins:control", () => {
    const actions = SOURCES.find((s) => s.file.endsWith("wins/actions.ts"))!.content
    const linkFn = actions.slice(actions.indexOf("getAssemblyLinkAction"))
    expect(linkFn).toContain('hasPermission("wins", "control")')

    const page = SOURCES.find((s) => s.file.endsWith("wins/page.tsx"))!.content
    expect(page).toContain("canControl")
    expect(page).toContain("assembly_deep_link: null")
  })

  it("re-checks a permission in every exported server action", () => {
    const actions = SOURCES.find((s) => s.file.endsWith("wins/actions.ts"))!.content
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(exported.length).toBeGreaterThanOrEqual(6)

    for (const name of exported) {
      const start = actions.indexOf(`export async function ${name}`)
      const next = exported
        .map((n) => actions.indexOf(`export async function ${n}`))
        .filter((i) => i > start)
        .sort((a, b) => a - b)[0]
      const body = actions.slice(start, next === undefined ? actions.length : next)
      expect(body, `${name} must check a permission server-side`).toContain("hasPermission(")
    }
  })
})
