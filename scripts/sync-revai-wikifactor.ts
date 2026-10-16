/**
 * Builds the RevAI Wikifactor snapshot (`lib/revai/wikifactor-corpus.json`).
 *
 * Wikifactor (federzimer/wikifactor) is the source of truth for frameworks and
 * the ontology. RevAI reads a bundled snapshot so answers never depend on a
 * live GitHub token. Re-run after Wikifactor changes:
 *
 *   pnpm revai:sync-wikifactor --repo ../wikifactor
 *   pnpm revai:sync-wikifactor --repo ../wikifactor --draft origin/some-branch
 *
 * Files are read with `git show <ref>:<path>`, so no checkout is touched.
 * `--base` (default origin/main) is the accepted vault. Each `--draft` ref adds
 * the Markdown files it adds or changes versus the base, tagged as draft so
 * RevAI says the page is not merged yet.
 */

import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"

import {
  chunkWikifactorMarkdown,
  type WikifactorCorpus,
  type WikifactorDoc,
} from "@/lib/revai/wikifactor"

const SKIP_PREFIXES = ["_templates/", "exports/", "tools/", "data/", ".github/"]
const OUTPUT = path.join(process.cwd(), "lib/revai/wikifactor-corpus.json")

function parseArgs(argv: string[]) {
  let repo = "../wikifactor"
  let base = "origin/main"
  const drafts: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === "--repo" && next) {
      repo = next
      i += 1
    } else if (arg === "--base" && next) {
      base = next
      i += 1
    } else if (arg === "--draft" && next) {
      drafts.push(next)
      i += 1
    }
  }
  return { repo: path.resolve(repo), base, drafts }
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

function markdownFiles(repo: string, ref: string): string[] {
  return git(repo, ["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .filter((file) => file.endsWith(".md"))
    .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
}

function readFile(repo: string, ref: string, file: string): string {
  return git(repo, ["show", `${ref}:${file}`])
}

function titleFor(file: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || path.basename(file, ".md")
}

function main() {
  const { repo, base, drafts } = parseArgs(process.argv.slice(2))
  const baseSha = git(repo, ["rev-parse", base]).trim()
  const docs = new Map<string, WikifactorDoc>()

  for (const file of markdownFiles(repo, base)) {
    const markdown = readFile(repo, base, file)
    docs.set(file, {
      path: file,
      title: titleFor(file, markdown),
      status: "accepted",
      branch: null,
      chunks: chunkWikifactorMarkdown(markdown),
    })
  }

  const draftRefs: WikifactorCorpus["drafts"] = []
  for (const ref of drafts) {
    const sha = git(repo, ["rev-parse", ref]).trim()
    draftRefs.push({ ref, sha })
    const changed = git(repo, ["diff", "--name-only", "--diff-filter=AM", `${base}...${ref}`])
      .split("\n")
      .filter((file) => file.endsWith(".md"))
      .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
    for (const file of changed) {
      const markdown = readFile(repo, ref, file)
      docs.set(file, {
        path: file,
        title: titleFor(file, markdown),
        status: "draft",
        branch: ref.replace(/^origin\//, ""),
        chunks: chunkWikifactorMarkdown(markdown),
      })
    }
  }

  const corpus: WikifactorCorpus = {
    generatedAt: new Date().toISOString(),
    base: { ref: base, sha: baseSha },
    drafts: draftRefs,
    docs: Array.from(docs.values()).sort((a, b) => a.path.localeCompare(b.path)),
  }

  writeFileSync(OUTPUT, JSON.stringify(corpus))
  const chunkCount = corpus.docs.reduce((sum, doc) => sum + doc.chunks.length, 0)
  console.log(
    `Wrote ${corpus.docs.length} pages (${chunkCount} chunks, ${
      corpus.docs.filter((doc) => doc.status === "draft").length
    } draft) to ${path.relative(process.cwd(), OUTPUT)}`
  )
}

main()
