# Telemetry

Southbag OS collects none. This document defines that as a scope, so
"no telemetry" is a verifiable contract rather than an absence of code.

## What the OS never sends

No component of the installed system transmits, queues for later
transmission, or asks a third party to collect on its behalf:

- Usage or interaction data (apps opened, features used, session length,
  click or key counts).
- Crash reports, stack traces, or core dumps.
- Device identifiers beyond what the network path itself reveals (below),
  and no persistent installation ID of any kind.
- Location, nearby-network, or sensor data.
- Input content of any kind. The input broker and the Kevin
  capitalisation worker see keystrokes to do their job; neither records,
  counts, or transmits them, and per-keystroke statistics are out of
  scope permanently.

## What leaves the device anyway

These are service connections the user or the update mechanism initiates,
not telemetry. Each reveals the source IP (and TLS hostname where
applicable) to the named peer and nothing more:

- **Updates.** apt fetches from deb.debian.org and the Southbag apt
  channel. The fetch carries the requested package paths; the OS sends no
  version report, success report, or heartbeat.
- **Time.** systemd-timesyncd NTP to the Debian pool.
- **Name resolution.** DNS to the DHCP-provided resolver.
- **Identity.** Auth flows against identity.southbag.cc, only when the
  user signs in. Identity's own in-product event tracking on its web
  pages is a property of that service, governed by its own policy, not
  by the OS.
- **Drive and Browser content.** Only when the user opens them.

## Local diagnostics

Kernel and service logs stay on the device in the systemd journal,
volatile (in-memory) on the live image, never uploaded. If a user wants
to share a log they export it themselves; there is no "send report"
path that moves data without an explicit file-level action.

## If telemetry is ever wanted

It arrives as a new, opt-in component with a per-category switch listed
in this document, defaulting to off, and this section names every field
it sends. Silent introduction would violate this document; a change
here is a product decision for the proprietor, not an implementation
detail.
