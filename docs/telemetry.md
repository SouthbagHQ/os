# Analytics (Palantir)

Southbag OS reports analytics exactly like every other Southbag service.
Collection is always on. There is no off switch, no consent prompt, and no
build without it; it is part of the product, decided by the proprietor.

## Transport

Palantir is Southbag's PostHog wiring. The shell serves the same
`palantir.js` every Southbag app serves (the file is maintained identical
across apps) and initialises it with:

- Project key `phc_rStyYsw4wrB8MwXEsPBJjz57uipHycNVwFPaw2m3aYXo`, sent to
  `https://palantir.southbag.cc` (Southbag's PostHog ingress; dashboards at
  `https://us.posthog.com`).
- Super property `southbag_app: "os"`, matching `identity`, `banking` and
  the other services, so events slice by app in one project.
- A first-party cookie on `.southbag.cc` plus localStorage persistence, so
  one person is the same person across every Southbag app.

## What is collected, client side

Same configuration as the other services, verbatim:

- Pageviews on every navigation, page-leave events, and full autocapture
  of clicks and form interactions.
- Heatmaps, dead clicks and rage clicks.
- Exceptions and console logs.
- Performance: network timing and web vitals.
- Session recording with no input masking (`maskAllInputs: false`),
  including cross-origin iframes, request headers and bodies, and canvas.
  What the user sees and types in the shell - including into credential
  fields - is reproducible in a recording. That is the standard Southbag
  configuration, not an OS-specific choice.

## Who events belong to

When the OS session is signed in, events identify as the user's Southbag
Identity account (id, email, name), resolved from the session itself or,
failing that, from Identity's `.southbag.cc` session cookie - the same
resolution every app does. A confirmed signed-out answer resets the
profile to anonymous rather than attributing events to a stale user.

## Server-side events

OS CGIs emit server events to the same project with
`$lib: "palantir-server"`, `source: "server"`, `southbag_app: "os"`, the
Identity user id as distinct id, and the browser's PostHog session id
(read from the `ph_…_posthog` cookie) so a server event joins the same
person and session replay as the click that caused it. IP, user agent and
URL ride along, as they do for Identity's auth events. Events include
sign-in begin/complete/failure, lock and unlock, account binding, update
application, and provisioning outcomes.

## Keystrokes and secrets

No component reads input devices for analytics. Form contents and typed
text are captured the same way they are in every Southbag app: through
autocapture and unmasked session recording in the shell, never through
the input broker or the Kevin capitalisation worker, which remain
transport-only.
