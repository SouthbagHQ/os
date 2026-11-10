#!/usr/bin/env bash
# Main ancestry grows on each merge. Unlike a hash, its numeric count sorts
# forward under dpkg. Refuse shallow history rather than publish version 1.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(git -C "$repo" rev-parse --is-shallow-repository)" = false ]] || {
  echo 'Full git history required for package versioning.' >&2; exit 1;
}
count="$(git -C "$repo" rev-list --count HEAD)"
printf '0.1.0+git%010d\n' "$count"
