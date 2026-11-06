# Updates

How Southbag OS patches itself without a management channel that takes
arbitrary root commands: every change is a versioned, signature-enforced
package from an apt repository Kevin controls.

## Channels

Two, both applied by `unattended-upgrades` (2.12 in trixie):

1. **Debian security.** The stock trixie origins
   (`origin=Debian,codename=${distro_codename}[-security],label=Debian-Security`),
   authenticated by `debian-archive-keyring` in the base system. No mirror.
2. **Southbag** (`southbag.sources`, this repo). Carries `southbag-shell`
   and, once their work lands, `southbag-lockd` and `southbag-browser` -
   `packaging/build-shell-deb.sh` and `packaging/build-lockd-deb.sh` build
   versioned packages reproducibly from the tree (lockd reproduces image
   hook 0016's wayland-scanner + gcc build exactly; it no-ops until the
   lock sources merge). The Browser package is published only when a release
   is pinned, and v1.0.0 must never be pinned: it predates app windows, and
   the current app/session fixes exist only in unmerged PRs with no release.

Devices trust exactly one key for the Southbag channel: the public half
committed at
`image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg`,
referenced with `Signed-By`. apt refuses anything not signed by it
([apt-secure(8)](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html)).

## CI proof

`.github/workflows/packages.yml` runs on every pull request (no secrets, no
signing, no deploy) and builds and structurally validates the packages. The
lockd sources are not on this branch yet, so for the compile test only the
workflow fetches them read-only from the `agent/session-lock` branch at
pinned commit `7e7803ca535b3107520ae1aee00c50f83f56598d`; nothing is merged,
committed or deployed, and the job fails rather than passing silently if the
sources cannot be fetched. Once the session-lock PR lands, the workflow
builds from the checked-out tree instead.

## Staged, fail-closed activation

The channel is inert until a one-time signing setup happens:

- Hook `0026-southbag-updates.hook.chroot` checks for the keyring at image
  build time. **Absent:** the sources entry is removed and main's CI cannot
  break over the channel. **Present:** the channel is enabled. Only the
  Southbag channel is staged: every image - keyed or not - installs
  `unattended-upgrades` and the `51southbag-updates` config, so Debian
  security auto-updates and the 03:30 auto-restart window are active from
  first boot. That is the requested auto-update/auto-restart behavior; it
  needs no signing setup and it is a real change to the default image.
- Until `SOUTHBAG_APT_SIGNING_KEY` exists as a repo secret, the pages
  workflow deploys the site without `/apt/` (with a warning) - the site
  deploy never fails over the missing repo.

How Southbag OS patches itself without a management channel that takes
arbitrary root commands: every change is a versioned, signature-enforced
package from an apt repository Kevin controls.

## Channels

Two, both applied by `unattended-upgrades` (2.12 in trixie):

1. **Debian security.** The stock trixie origins
   (`origin=Debian,codename=${distro_codename}[-security],label=Debian-Security`),
   authenticated by `debian-archive-keyring` in the base system. No mirror.
2. **Southbag** (`southbag.sources`, this repo). Carries `southbag-shell`
   and, once their work lands, `southbag-lockd` and `southbag-browser` -
   `packaging/build-shell-deb.sh` and `packaging/build-lockd-deb.sh` build
   versioned packages reproducibly from the tree (lockd reproduces image
   hook 0016's wayland-scanner + gcc build exactly; it no-ops until the
   lock sources merge). The Browser package is published only when a release
   is pinned, and v1.0.0 must never be pinned: it predates app windows, and
   the current app/session fixes exist only in unmerged PRs with no release.

Devices trust exactly one key for the Southbag channel: the public half
committed at
`image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg`,
referenced with `Signed-By`. apt refuses anything not signed by it
([apt-secure(8)](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html)).

## CI proof

`.github/workflows/packages.yml` runs on every pull request (no secrets, no
signing, no deploy) and builds and structurally validates the packages. The
lockd sources are not on this branch yet, so for the compile test only the
workflow fetches them read-only from the `agent/session-lock` branch at
pinned commit `7e7803ca535b3107520ae1aee00c50f83f56598d`; nothing is merged,
committed or deployed, and the job fails rather than passing silently if the
sources cannot be fetched. Once the session-lock PR lands, the workflow
builds from the checked-out tree instead.

## Staged, fail-closed activation

The channel is inert until a one-time signing setup happens:

- Hook `0026-southbag-updates.hook.chroot` checks for the keyring at image
  build time. **Absent:** the sources entry is removed and main's CI cannot
  break over the channel. **Present:** the channel is enabled. Only the
  Southbag channel is staged: every image - keyed or not - installs
  `unattended-upgrades` and the `51southbag-updates` config, so Debian
  security auto-updates and the 03:30 auto-restart window are active from
  first boot. That is the requested auto-update/auto-restart behavior; it
  needs no signing setup and it is a real change to the default image.
- Until `SOUTHBAG_APT_SIGNING_KEY` exists as a repo secret, the pages
  workflow deploys the site without `/apt/` (with a warning) - the site
  deploy never fails over the missing repo.
- An empty browser pin ships no browser package; a missing lockd source
  tree ships no lockd package. Absent things stay absent rather than
  breaking the build.
- The repo's `Valid-Until` is 30 days and the pages workflow re-signs
  weekly, so a stalled pipeline degrades to apt refusing the stale repo
  (fail closed), never to silently installing from it. GitHub pauses
  scheduled workflows after 60 days of repo inactivity; any push or manual
  run restarts the clock - if the repo is otherwise dormant for months,
  re-run the pages workflow before the 30 days lapse.

### Activation, once granted

Signing setup is authorized account work, not something handed to a person
to paste. An authorized operator (an Instinct task agent or maintainer with
credentials allowed to write this repo's Actions secrets) runs
`packaging/setup-signing.sh`: it generates the ed25519 key in a temp
keyring and exports the private half twice: ARMORED into `gh secret set
SOUTHBAG_APT_SIGNING_KEY` (the format `packaging/build-repo.sh` imports in
CI), and BINARY OpenPGP into a 0600 staging file for the recovery copy -x
both representations import identically into gpg. Storing the recovery
copy through the platform's sanctioned persistent-secret mechanism for
agent-generated credentials is a REQUIRED step of activation, not an
option: activation is not complete until it is stored and the staging file
shredded (the exact storage contract is the executing agent's to follow,
not this repo's). The script fails closed if gh is missing or
unauthenticated. GitHub secrets are write-only, so the stored recovery
copy is the rotation authority: lose both and the old key can never sign
again, stranding devices on a re-flash for rotation. Order: set the secret, let pages publish `/apt/`, then
commit the public key - committing the keyring first would point devices at
a repo that is not there yet. Devices join the channel from an ISO built
after that; anything already installed needs one re-flash to join. Every
update after that is in-place.

## What "automatic" means, exactly

- Each device updates on its own schedule: the stock trixie timers are
  `apt-daily.timer` (downloads package lists at 06:00 and 18:00, up to 12 h
  random delay) and `apt-daily-upgrade.timer` (installs at 06:00, up to
  60 min random delay, ordered after the download timer) - verified from
  the apt 3.0.3 unit files. Both are `Persistent=true`, so a device that
  was off catches up at boot. Worst case publish-to-install is dominated by
  the download timer's 12 h randomization plus ordering: typically within
  about a day, but no tighter bound is promised, and devices neither
  download nor restart at the same moment.
- `Automatic-Reboot "true"` + `Automatic-Reboot-Time "03:30"` (our chosen
  default; no time was specified): when an upgrade leaves
  `/var/run/reboot-required` (the kernel sets it for itself, Southbag
  packages set it in postinst), the device reboots at 03:30 device-local
  time. Verified against the trixie 2.12 source: `Automatic-Reboot-WithUsers`
  defaults to true, so the reboot fires even with a session logged in - we
  set it explicitly to keep that visible. **The reboot ends whatever
  session is active at 03:30.** That is the same loss any shutdown causes
  on this OS (`/home/customer` and `/tmp` are RAM; sign-in is per boot),
  but anything open at 03:30 - a half-finished download, an unsubmitted
  form - is gone. A device off at 03:30 reboots after its next upgrade run
  instead.
- `unattended-upgrades` pulls in a python3 stack (debconf, python3-apt,
  python3-dbus, python3-distro-info, ucf, lsb-release, xz-utils) - tens of
  MB of image for the standard updater. The alternative (a shell script and
  a timer) loses origin filtering and the reboot machinery.

## Persistence

- **Installed copy:** the system partition is writable, so package upgrades
  persist across reboots. This is the configuration the channel serves.
- **Live USB (RAM-only):** upgrades apply for the current boot and vanish at
  shutdown; lasting updates need a refreshed ISO.

## Hosting: GitHub Pages, with the honest limits

The repo is static files under `dist/apt/` on the existing Pages site:
`https://southbaghq.github.io/os/apt`.

- The Browser v1.0.0 `.deb` is 100,592,576 bytes (~96 MiB). Cloudflare
  Workers **static assets** and Cloudflare Pages both cap a single file at
  25 MiB ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)),
  so a Worker serving files from its own asset storage cannot hold the
  package. A Worker could still serve the repo by proxying GitHub Releases
  or R2 - that is real code, a second service, and a second trust path for
  no gain at this fleet size. Pages already exists on this repo and needs
  none of that.
- Policy check ([limits page](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)):
  Pages may not host an online business, e-commerce or SaaS, or sensitive
  transactions. A free open-source project serving its own signed OS
  packages to its own devices is none of those; the soft bandwidth cap and
  429 rate limits are the practical ceiling, and heavy binary distribution
  is exactly what GitHub steers to Releases (see the exit below).
- Pages numeric limits ([docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)):
  1 GB published site, 100 GB/month soft bandwidth, 10-minute deploys. The
  Actions deploy path does not go through git, so git's 100 MiB file block
  ([docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github))
  is not the constraint; the site size is. Arithmetic, not vibes: metadata
  is KBs per device per day, the shell package is a few MB, and a browser
  update is ~96 MiB - 100 GB/month absorbs roughly a thousand full browser
  downloads. A fleet of tens is far inside that; a fleet of thousands is
  not. GitHub also recommends Releases for distributing large binaries - if
  the browser package crosses 100 MiB or the fleet grows, move the pool to
  Releases assets or R2 and repoint `Filename:`; the metadata and signing
  story is unchanged.

## Signing and keys

- `packaging/build-repo.sh` writes `dists/stable` with `InRelease` and
  `Release.gpg` (ed25519, SHA-512 digests) using the private key from the
  `SOUTHBAG_APT_SIGNING_KEY` secret. The private key exists only in that
  secret and in the temp keyring that created it; the public key is
  committed (not a secret) and pinned with `Signed-By`.
- **Rotation:** ship the new public key in a `southbag-shell` update signed
  by the old key, or in a new image. Devices that miss every update signed
  by the old key (or survive its compromise) can be stranded on a manual
  re-flash - the price of `Signed-By` pinning.
- **Rollback:** apt never downgrades unless a pin priority exceeds 1000,
  which nothing here sets
  ([apt_preferences(5)](https://manpages.debian.org/trixie/apt/apt_preferences.5.en.html)).
  A bad package is fixed by rolling forward a higher version.

## Fail-safes and recovery

- `packaging/verify-repo.sh` runs in the deploy workflow before publish:
  apt pointed at the just-built repo, trusting only the committed keyring,
  must accept the signature or the deploy fails. Locally verified both
  ways: a clean repo validates; metadata tampered after signing fails apt's
  hash check ("index files failed to download").
- A repo that loses its authenticated state hard-errors in every apt
  client; the Debian security origin is independent and unaffected.
- A bad Southbag package reaches every device (that is what fleet-wide
  means). Recovery: build the fix, bump the version, push - devices pick it
  up on their next daily check, within about a day. That only works while
  devices still boot and reach the network; if the breakage takes out boot,
  networking, or the updater itself, the recovery path is a re-flash.
- The ISO never depends on the channel: `image/build.sh` still copies the
  shell in as files and hook 0016 still builds lockd in the chroot, so
  images build and boot with the repo down or absent.

## Deliberately absent

- **No telemetry.** Static files; apt fetches reveal source IPs to the
  host, nothing is reported back by the OS. Device-health or usage
  collection is a separate undecided question; nothing here builds it.
- **No per-device channels or staged rollout.** Requested away. If wanted
  later: a second suite (`dists/testing`) plus a different sources file on
  test devices.
- **No downgrade support, no A/B partitions.** Roll forward, re-flash as
  the floor.
