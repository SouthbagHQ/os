#!/usr/bin/env bash
# One-time signing setup for the Southbag apt channel. Run ONCE by an
# authorized operator agent after the owner grants that setup. Persistent-
# secret rules apply throughout: the private key is never printed, never
# left on disk, and never passes through a person.
#
# Prereq for the operator: gh authenticated as an identity allowed to write
# this repo's Actions secrets. The script generates the key in a temp
# keyring, then:
#   1. pipes the private key straight into gh secret set (CI's copy), and
#   2. writes it to a 0600 staging file for the operator to store through
#      whatever persistent-secret mechanism the platform sanctions for
#      agent-generated credentials at execution time - never printed, never
#      read back, the staging file shredded right after.
# GitHub secrets are write-only, so that stored copy is the recovery and
# rotation authority: without it, losing the secret means the old key can
# never sign again and devices need a re-flash to rotate. The operator owns
# the exact storage contract; this script only guarantees the key passes
# through no person, no chat and no log.
#
# Fails closed: if gh or the auth is missing, nothing is generated.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$repo_root/image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg"

[[ -s "$out" ]] && { echo "Keyring already exists at $out - rotation is deliberate, see docs/updates.md." >&2; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found; cannot store the secret safely." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; run 'gh auth login' first." >&2; exit 1; }

name="Southbag OS Archive Signing Key"
mail="os-updates@southbag.cc"
gnupg="$(mktemp -d)"
trap 'rm -rf "$gnupg"' EXIT
export GNUPGHOME="$gnupg"
chmod 700 "$gnupg"

gpg --batch --pinentry-mode loopback --passphrase "" \
  --quick-generate-key "$name <$mail>" ed25519 sign never
fpr="$(gpg --batch --with-colons -k "$mail" | awk -F: '/^fpr:/ {print $10; exit}')"

# 1. CI's copy: private half straight into the Actions secret, armored
#    (this is the format packaging/build-repo.sh imports).
gpg --batch --pinentry-mode loopback --passphrase "" --armor \
  --export-secret-keys "$fpr" \
  | gh secret set SOUTHBAG_APT_SIGNING_KEY --repo SouthbagHQ/os

# 2. Recovery copy: the same key as BINARY OpenPGP (the CI copy above is
#    ASCII-armored; both import identically) in a 0600 staging file. The
#    operator MUST store it through the sanctioned secret mechanism and
#    shred this file right after - activation is not done until it is
#    stored, because the GitHub secret is write-only.
staging="$(mktemp /tmp/southbag-signing-key.XXXXXXXX)"
gpg --batch --pinentry-mode loopback --passphrase "" \
  --export-secret-keys "$fpr" > "$staging"

mkdir -p "$(dirname "$out")"
gpg --batch --export "$fpr" > "$out"

echo "Secret set on SouthbagHQ/os (key $fpr); public key at $out (commit it)."
echo "Now store $staging through the sanctioned secret store, then shred it."
