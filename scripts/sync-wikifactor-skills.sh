#!/usr/bin/env bash
# Refresh data/wikifactor/skills.json from a wikifactor checkout.
# Wikifactor is the source of truth; never hand-edit the Hub copy.
# Usage: scripts/sync-wikifactor-skills.sh [path-to-wikifactor]   (default ../wikifactor)
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
WIKI="$(cd "${1:-$HUB/../wikifactor}" && pwd)"
python3 "$WIKI/tools/brain/export_skills.py" "$HUB/data/wikifactor/skills.json"
