#!/usr/bin/env bash
# Builds the Southbag OS ISO.
#
# live-build needs a Debian host with loop devices and root, so this runs in a
# privileged Debian container. It works the same on a Linux workstation and on
# a CI runner; it cannot run on macOS.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"

if [[ ! -d "$repo/dist-device" ]]; then
  echo "No dist-device/. Run 'bun run build:device' first." >&2
  exit 1
fi

# Optional exact offline dormant worker artifact. Default images carry no
# worker binary. The helper clears stale staging when the input is absent.
if [[ -n "${SOUTHBAG_INJECT_DEB:-}" || -n "${SOUTHBAG_INJECT_SOURCE:-}" ]]; then
  bash "$repo/packaging/stage-inject-image.sh" "${SOUTHBAG_INJECT_DEB:?}" "${SOUTHBAG_INJECT_SOURCE:?}" "${SOUTHBAG_INJECT_LANE:-guest-tested}"
else
  bash "$repo/packaging/stage-inject-image.sh"
fi
trap 'rm -f "$here/config/includes.chroot/tmp/southbag-inject-candidate.deb"; rm -rf "$here/config/includes.chroot/tmp/southbag-package-build"' EXIT

# Set to a Southbag Browser release tag to include the standalone browser in
# the image (website apps then open as its app windows; see
# config/hooks/normal/0025-southbag-browser.hook.chroot). Must be a release
# that contains app windows — v1.0.0 predates them. Empty keeps the image
# cog-only.
SOUTHBAG_BROWSER_VERSION=""

# The shell is ordinary files on disk, served over loopback at boot. This
# directory is generated, so anything hand-written that belongs beside the
# bundle — the launcher CGI — is kept in shell-extra and copied in after.
served="$here/config/includes.chroot/usr/share/southbag-shell"
rm -rf "$served"
mkdir -p "$served"
cp -R "$repo/dist-device/." "$served/"
cp -R "$here/shell-extra/." "$served/"
# Executable bits, set explicitly rather than trusted to the checkout: the
# device runs these as CGI, and git modes survive neither every checkout nor
# every web flow that can land these files.
chmod +x "$served/cgi-bin/launch" "$served/cgi-bin/identity-auth" \
  "$served/cgi-bin/lock" "$served/cgi-bin/account" "$served/cgi-bin/device-session" \
  "$served/cgi-bin/volume"

# Register image content as installed packages, so unattended-upgrades can
# actually select later versions (copying loose files is not installation).
version="$(bash "$repo/packaging/package-version.sh")"
staging="$here/config/includes.chroot/tmp/southbag-package-build"
rm -rf "$staging"
mkdir -p "$staging/packaging" "$staging/image/config" "$staging/pool"
bash "$repo/packaging/build-shell-deb.sh" "$version" "$repo/dist-device" "$staging/pool"
cp "$repo/packaging/build-lockd-deb.sh" "$staging/packaging/"
printf '%s' "$version" > "$staging/version"
# Inside the chroot, the recipe's source/helper paths resolve to the image.
ln -s / "$staging/image/config/includes.chroot"

# live-build executes hooks straight from this tree, so every hook's
# executable bit matters here — set them all, don't trust the checkout.
for hook in "$here"/config/hooks/normal/*.hook.*; do
  [[ -f "$hook" ]] && chmod +x "$hook"
done

# Same story for the lock helpers shipped via includes.chroot: web flows
# land files as 644 and the lock is useless if these are not executable.
chmod +x "$here/config/includes.chroot/usr/local/bin/southbag-device-session"
chmod +x "$here/config/includes.chroot/usr/local/bin/southbag-nav-state"
chmod +x "$here/config/includes.chroot/usr/local/bin/southbag-analytics"
chmod +x "$here/config/includes.chroot/usr/local/bin/southbag-shell"
chmod +x "$here/config/includes.chroot/usr/local/bin/southbag-lock" \
  "$here/config/includes.chroot/usr/local/bin/southbag-unlock" \
  "$here/config/includes.chroot/usr/local/bin/southbag-face-unlock"
# The root-owned input broker likewise ships through trees that may carry
# web-flow 644 modes; the boot unit fails if it is not executable.
chmod +x "$here/config/includes.chroot/usr/local/sbin/southbag-input-broker"
# Test fixtures are executed directly by the suite via PATH; same web-flow
# 644 hazard, so cover them here as well.
chmod +x "$repo/tests/fixtures/bin/systemctl" "$repo/tests/fixtures/bin/systemd-run" 2>/dev/null || true

# Hand the browser pin to the chroot hook (or remove a stale one).
pin="$here/config/includes.chroot/etc/default/southbag-browser"
rm -f "$pin"
if [[ -n "$SOUTHBAG_BROWSER_VERSION" ]]; then
  mkdir -p "$(dirname "$pin")"
  printf '%s' "$SOUTHBAG_BROWSER_VERSION" > "$pin"
fi

docker run --rm --privileged \
  -v "$here:/image" -w /image \
  debian:trixie /bin/bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends live-build xorriso

    # UEFI only. grub-efi rather than systemd-boot: a hybrid live ISO is not
    # the A/B verity layout systemd-boot was chosen for, and grub-efi is what
    # live-build can actually produce here.
    #
    # --debian-installer live, not true: the installer copies the live
    # filesystem onto the disk, so what gets installed is this image rather
    # than a stock Debian reassembled from packages. Text installer; the
    # graphical one is weight for a step taken once.
    lb config \
      --distribution trixie \
      --architecture amd64 \
      --archive-areas main \
      --binary-images iso-hybrid \
      --bootloaders grub-efi \
      --memtest none \
      --debian-installer live \
      --debian-installer-gui false \
      --apt-recommends false \
      --apt-indices false \
      --firmware-chroot false \
      --bootappend-live "boot=live live-config.hostname=southbag console=tty0 console=ttyS0,115200n8" \
      --iso-application "Southbag OS" \
      --iso-publisher "Southbag" \
      --iso-volume "Southbag OS"

    lb build
  '

# live-build names the output after the image type.
iso="$(find "$here" -maxdepth 1 -name "live-image-amd64.hybrid.iso" -print -quit)"
if [[ -z "$iso" ]]; then
  echo "Build produced no ISO." >&2
  exit 1
fi
mkdir -p "$repo/out"
mv "$iso" "$repo/out/southbag-os.iso"
ls -lh "$repo/out/southbag-os.iso"
