# Account freeze gate

Requires Identity's read-only `GET /api/account/status` before this image is rolled out. Do not deploy this OS first: an absent endpoint fails closed. No shared service secret belongs in a public ISO.

The OS sends its signed-in user's OAuth bearer to that endpoint. Identity validates it through its OAuth provider, then reads the owner's current `user.frozen` row. A caller cannot select a different account. Responses are not cached and contain no freeze reason or recovery-fee details. This endpoint cannot freeze, unfreeze or charge anyone.

The device requires an explicit `frozen: false`, matching subject, current generation and unexpired private token:

- before binding a sign-in;
- before opening each app;
- before accepting a password, TOTP or face unlock;
- while the desktop is open, with a check 15 seconds after the previous check completes.

Each check has an 8-second network timeout and a 12-second process deadline. This is polling, not instantaneous revocation. A freeze immediately after a successful check is noticed on a later check. A stalled launch/reset lock or overloaded device can add delay. No real user's account is polled by the development tests.

A freeze, token expiry, deleted account, malformed response, redirect or Identity/network failure denies access. The watcher obtains a compositor session lock before resetting all tracked apps, profiles, cookie jar, handoffs and account binding. If the lock cannot be obtained, it ends the graphical seat and still attempts cleanup. If teardown cannot prove all writers stopped, it keeps the era blocked and ends the seat. A new seat only gets the cleanup recovery page, not account apps; successful cleanup can then show a fresh login. Old callbacks remain generation-fenced.

The notice on the clean login explains that account access could not be verified. A frozen customer must recover their account at Identity on another device, then sign in again. Recovery fees and freeze administration are unchanged. Kevin remains inhibited after reset until reboot, as with ordinary sign-out.

This intentionally makes Identity availability a requirement for an open OS session, not only for unlocking. Expired OAuth sessions require sign-in again; no refresh-token or cached-active grace is added here. Rollout approval must include this behavior and the approximately four background requests per minute per signed-in device, plus app/unlock checks. No production deploy, merge or OS release is part of these review branches.

This is a managed-session gate, not secure boot or tamper resistance against a customer modifying their own writable live system. Existing local-process and root access limits still apply.

## Qualification

Contract tests use synthetic users and local HTTP fixtures, including active-to-frozen transitions, missing/deleted/malformed users, expiry, identity/generation mismatch, redirects, secret-file permissions, app denial, teardown and seat-stop failure paths. Nothing freezes a real account or invokes paid recovery. The existing lifecycle tests inject explicit active-status fixtures so they continue testing their original contracts. Final integrated image qualification against the deployed endpoint is a separate rollout gate.
