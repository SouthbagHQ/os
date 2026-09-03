# Southbag OS

A desktop operating system for Southbag. The machine is a thin client, the
account is the device, and there is no local user.

Milestone 1 is the boot-to-desktop moment and the shell around it. It runs in a
browser because that is the fastest way to iterate on the shell, not because
the OS is a website.

## Running it

```sh
bun install
bun run dev
```

`bun run build` type-checks, builds, and enforces the bundle budget.

## Bundle budget

Lightweight is the product, not an optimisation pass. `budget.json` sets a
gzipped ceiling per bucket and `bun run build` fails if any bucket is over.
Raising a number is a tracked diff; say why in the commit message.

| Bucket | Ceiling |
| --- | --- |
| JavaScript | 80 KB |
| CSS | 14 KB |
| Fonts | 60 KB |
| HTML | 3 KB |

## Constraints

- **Target runtime is WPE WebKit via `cog`, not Chromium.** Develop against a
  normal browser, but check features against WebKit before adopting them and
  keep polyfills out. No View Transitions API, no `text-wrap: balance`, no
  `backdrop-filter` (supported, but a full-surface per-frame composite is not
  free on 2013 integrated graphics).
- **Deploys to `/os/`.** `base` is set in `vite.config.ts`; asset URLs in
  `index.html` go through `%BASE_URL%`.
- **No backend.** State lives in `localStorage`.
- **Fonts are self-hosted and subset.** The device boots offline.
- Performance is measured on a throttled CPU and a capped memory profile, not
  on the development machine.

## Structure

The shell is four surfaces, composed in `src/Desktop.svelte` and nowhere else.
Under `labwc` each is a separate layer-shell client, so nothing here may depend
on them sharing a page or being able to measure one another.

```
src/
  Desktop.svelte          composition root, and the only file that knows
                          the surfaces currently share a document
  surfaces/
    boot/                 power-on to greeting
    wallpaper/
    panel/
  platform/               identity, clock — everything an app receives
  styles/tokens.css       the institution's design tokens
```

`src/styles/tokens.css` extends the token set in `SouthbagHQ/website`. It does
not define a second design system.

### The boot travel

The mark starts centred and ends as the panel launcher, in one continuous
transform. The flight path is resolved entirely in CSS from shared panel
geometry tokens, so neither surface measures the other — a layer-shell client
cannot read another surface's layout, and the browser build must not rely on
being able to.

Timings live in `src/surfaces/boot/sequence.svelte.ts`. In development,
`?boot=6` stretches both the beats and the travel so the sequence can be
watched.

## Target platform

Debian stable, systemd, Wayland, no X11. `labwc` owns compositing, input and
window geometry. The shell is a layer-shell surface; each Southbag app is its
own `cog` window. No display manager — a systemd user session with autologin.
systemd-boot, UEFI only. A/B partitions with dm-verity, read-only root,
`systemd-sysupdate`, images built with `mkosi`.

2013-era Intel graphics are fine on modern Mesa and Wayland. NVIDIA of that
vintage on nouveau is not.
