#!/usr/bin/env bash
# Fetches the pinned Southbag Browser .deb from its GitHub release, verifying
# the release's own SHA256SUMS before the package enters our repo pool - the
# same check the image hook (0025-southbag-browser.hook.chroot) does at build
# time.
#
#   fetch-browser-deb.sh <version-or-empty> <out-dir>
#
# An empty version is not an error: the image ships cog-only until a release
# with app windows exists, and the repo simply carries no browser package.
# Keep this pin and SOUTHBAG_BROWSER_VERSION in image/build.sh the same.
set -euo pipefail

version="${1:-}"
outdir="${2:?usage: fetch-browser-deb.sh <version-or-empty> <out-dir>}"

if [[ -z "$version" ]]; then
  echo "No browser version pinned; repo carries no southbag-browser package."
  exit 0
fi

deb="southbag-browser-${version#v}-linux-amd64.deb"
base="https://github.com/SouthbagHQ/browser/releases/download/$version"
mkdir -p "$outdir"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$deb" "$base/$deb"
curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt"
( cd "$tmp" && grep "  $deb\$" SHA256SUMS.txt | sha256sum -c - )
mv "$tmp/$deb" "$outdir/$deb"
echo "$outdir/$deb"
