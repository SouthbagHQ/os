# Analytics (Palantir)

Southbag OS uses the same `palantir.js` collector as the other Southbag
services. Collection is always on, with no product off switch.

The browser collector sends to `https://palantir.southbag.cc`, using project
`phc_rStyYsw4wrB8MwXEsPBJjz57uipHycNVwFPaw2m3aYXo` and the `southbag_app: os`
property. Its configuration enables pageviews, page leave, autocapture,
heatmaps, dead clicks, rage clicks, exceptions, performance timing, console
logs and session replay. It requests unmasked inputs, cross-origin iframe
recording, headers, bodies and canvas recording, exactly like the other
Southbag services. That configuration can include sensitive typed data.
Do not enter real credentials during replay qualification: use synthetic
fixtures and inspect the actual received recording.

Configuration is not a promise that every browser surface or field can be
recorded. Browser isolation and the upstream SDK's protections still apply.
In particular, a cross-origin page is not made readable merely by enabling
the iframe setting. The OS does not read input devices for analytics.
The input broker and capitalisation worker stay transport-only.

The shell starts the collector after resolving the local sign-in state.
When signed in, its dataset identifies the verified session subject, email
and name. The collector's existing Identity fallback handles anonymous pages.
The common collector requests cross-subdomain cookies, but the device shell
runs at `http://127.0.0.1:8080`: it cannot set or read a `.southbag.cc` cookie
from that origin. Its local persistence is separate. Account identification,
not an invented shared cookie, links the signed-in person across services.

Explicit client events currently cover sign-in begin, sign-in failure,
session ready and sign-out begin. The account CGI emits account-bound and
account-cleared outcomes through a fixed server helper. The lock and unlock
helpers emit lock-engaged, unlock-succeeded and unlock-refused outcomes. Those events use the documented `https://us.i.posthog.com/i/v0/e/` server
ingest endpoint for the same US project. The browser proxy rejects command-line
requests with Cloudflare error 1010, so server outcomes do not use that proxy.
Those events use
`$lib: palantir-server`, `source: server` and `southbag_app: os`. The helper
uses the independently verified account note as the distinct id and, when
present, joins the browser replay with its PostHog session id. It does not
forward bearer tokens, raw cookies, request bodies or free-form errors.
Other CGI outcomes are not yet wired; the helper's allowlist is not proof
that those call sites exist.

Analytics transport failure is bounded and best-effort. It does not approve
or refuse authentication, binding, locking or updates. Runtime replay and
server-ingress qualification remain separate gates from code integration.

## Runtime evidence

A synthetic Chromium fixture loaded SDK 1.447.7 and sent events and replay
snapshots with successful HTTP responses. Decoding the outgoing recording
showed plain sample text but asterisks for the password field, despite
`maskAllInputs: false`. The shared SDK retains that protection. This is not
WPE qualification or proof of backend storage and playback. The Chromium
harness used a normal browser user agent and disabled its automation marker
to exercise recording; unmodified headless automation was filtered by the SDK.

PostHog capture API reference: https://posthog.com/docs/api/capture
