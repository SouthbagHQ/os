# One device sign-in

The OS shell and Browser have different web engines. They now share the completed
OS sign-in without asking for another Browser OAuth client or another consent round.
The first OS consent remains unchanged: `openid profile email`, PKCE, signed ID-token
and nonce verification, followed by an independent userinfo account binding.

The shell's WPE cookie jar lives under the private `device-session` root. Account
binding stages the existing short-lived access token, verified subject, expiry and
generation there. Under the same lock used by reset, the Browser launch helper
exports only Identity's secure HttpOnly session cookie. No password, arbitrary site
cookie, extra OAuth scope or refresh token is copied. Files are mode 0600 and the
session root is mode 0700. No credential contents are logged.

Browser 1.1.1 or later checks the handoff's owner, mode, non-symlink file shape,
generation and expiry. It calls Identity userinfo itself and requires the same
subject, checks the web cookie with Identity get-session against that subject,
then rechecks the generation and credentials before installing the cookie
in its own browsing session. Independent Browser login is disabled on OS-managed
launches. Standalone Browser sign-in is unchanged. The existing one-hour OS session
limit still applies; renew it by signing out and signing in to the OS.

A missing, expired, insecure or mismatched handoff fails closed. It must never fall
back to an unrelated Browser account. The recovery window does not open this cookie
jar. Sign-out clears staged credentials and the reset manager stops all scoped apps
before wiping the private profiles and rotating the generation. Existing installations
need one OS sign-in after upgrading because older sessions did not stage a handoff.

Southbag services may still request their own first-use consent. Removing Browser's
duplicate sign-in does not make untrusted service clients trusted or skip their consent.
