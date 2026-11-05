#!/usr/bin/env bash
# Proves a device can use the repository before it is published: apt-get
# update against the repo directory with ONLY the committed public keyring
# trusted, then show what a device would be offered.
#
#   verify-repo.sh <repo-dir>
set -euo pipefail

repo_dir="${1:?usage: verify-repo.sh <repo-dir>}"
tree="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keyring="$tree/image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg"
[[ -s "$keyring" ]] || { echo "No committed keyring at $keyring." >&2; exit 1; }

repo_dir="$(cd "$repo_dir" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/lists/partial" "$tmp/etc"

printf 'deb [signed-by=%s] file://%s stable main\n' "$keyring" "$repo_dir" > "$tmp/etc/sources.list"

apt-get update \
  -o Dir::Etc::sourcelist="$tmp/etc/sources.list" \
  -o Dir::Etc::sourceparts="-" \
  -o Dir::State::Lists="$tmp/lists" \
  -o APT::Get::ListCleanup="0" \
  -o Debug::NoLocking="1" 2>&1 | tee "$tmp/update.log"

if grep -q "NO_PUBKEY\|not signed\|The following signatures were invalid" "$tmp/update.log"; then
  echo "E: signature verification problem above." >&2
  exit 1
fi
grep -q "stable InRelease" "$tmp/update.log" \
  || { echo "E: apt did not accept the signed InRelease." >&2; exit 1; }

echo "--- Packages a device would see ---"
pkgs="$(awk '/^Package: / {print $2}' "$repo_dir/dists/stable/main/binary-amd64/Packages" | sort -u)"
apt-cache policy \
  -o Dir::Etc::sourcelist="$tmp/etc/sources.list" \
  -o Dir::Etc::sourceparts="-" \
  -o Dir::State::Lists="$tmp/lists" $pkgs
echo "Repository verifies against the committed keyring."
