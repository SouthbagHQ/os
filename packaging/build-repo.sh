#!/usr/bin/env bash
# Builds the signed apt repository from a pool of .debs.
#
#   build-repo.sh <pool-dir> <out-dir>
#
# The private signing key comes in through the SOUTHBAG_APT_SIGNING_KEY
# environment variable (an ASCII-armored key, stored as a GitHub Actions
# secret). The matching public key must be the one committed at
# image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg.
#
# Self-contained on purpose: dpkg-deb, gpg, gzip and coreutils only, so the
# whole release path stays readable in one file. amd64 is the only
# architecture the OS ships.
set -euo pipefail

pool="${1:?usage: build-repo.sh <pool-dir> <out-dir>}"
out="${2:?}"

[[ -n "${SOUTHBAG_APT_SIGNING_KEY:-}" ]] || { echo "SOUTHBAG_APT_SIGNING_KEY is not set. See docs/updates.md." >&2; exit 1; }

shopt -s nullglob
debs=( "$pool"/*.deb )
(( ${#debs[@]} )) || { echo "Pool $pool has no .debs." >&2; exit 1; }

gnupg="$(mktemp -d)"
trap 'rm -rf "$gnupg"' EXIT
export GNUPGHOME="$gnupg"
chmod 700 "$gnupg"
printf '%s' "$SOUTHBAG_APT_SIGNING_KEY" | gpg --batch --import --quiet
fpr="$(gpg --batch --with-colons -k | awk -F: '/^fpr:/ {print $10; exit}')"

bindir="$out/dists/stable/main/binary-amd64"
mkdir -p "$bindir"

# One Packages entry per package. Architecture: all packages belong in the
# amd64 index too; there is no other architecture to publish.
: > "$bindir/Packages"
for deb in "${debs[@]}"; do
  dpkg-deb -f "$deb"
  base="$(basename "$deb")"
  printf 'Filename: pool/%s\n' "$base"
  printf 'Size: %s\n' "$(stat -c %s "$deb")"
  printf 'SHA256: %s\n\n' "$(sha256sum "$deb" | cut -d' ' -f1)"
done >> "$bindir/Packages"
gzip -9k "$bindir/Packages"

mkdir -p "$out/pool"
cp "${debs[@]}" "$out/pool/"

cat > "$bindir/Release" <<REL
Archive: stable
Component: main
Origin: Southbag
Label: Southbag OS
Architecture: amd64
REL

# Top-level Release with hashes of every metadata file, then InRelease
# (inline-signed) and Release.gpg (detached) for apt-secure.
release="$out/dists/stable/Release"
{
  echo "Origin: Southbag"
  echo "Label: Southbag OS"
  echo "Suite: stable"
  echo "Codename: stable"
  echo "Architectures: amd64"
  echo "Components: main"
  echo "Date: $(date -u -R)"
  echo "Valid-Until: $(date -u -R -d '+30 days')"
  echo "SHA256:"
  ( cd "$out/dists/stable" && find main -type f ! -name '*.gz' -o -type f -name '*.gz' \
      | sort | while read -r f; do
          printf ' %s %8d %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$(stat -c %s "$f")" "$f"
        done )
} > "$release"
gpg --batch --pinentry-mode loopback --passphrase "" --default-key "$fpr" \
  --digest-algo SHA512 --clearsign -o "$out/dists/stable/InRelease" "$release"
gpg --batch --pinentry-mode loopback --passphrase "" --default-key "$fpr" \
  --digest-algo SHA512 -abs -o "$out/dists/stable/Release.gpg" "$release"

echo "Signed repository at $out (key $fpr)"
