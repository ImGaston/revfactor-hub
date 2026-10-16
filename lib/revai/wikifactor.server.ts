import "server-only"

import corpusJson from "@/lib/revai/wikifactor-corpus.json"
import {
  buildWikifactorIndex,
  type WikifactorCorpus,
  type WikifactorIndex,
} from "@/lib/revai/wikifactor"

// The snapshot is bundled with the deployment; the index is built once per
// server instance and reused across requests.
let cached: { corpus: WikifactorCorpus; index: WikifactorIndex } | null = null

export function getWikifactor() {
  if (!cached) {
    const corpus = corpusJson as WikifactorCorpus
    cached = { corpus, index: buildWikifactorIndex(corpus) }
  }
  return cached
}
