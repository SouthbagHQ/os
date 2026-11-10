import "./styles/tokens.css";
import "./styles/base.css";
import { mount } from "svelte";
import Desktop from "./Desktop.svelte";
import AppFrame from "./AppFrame.svelte";
import Login from "./surfaces/login/Login.svelte";
import { currentSession, logout } from "./platform/identity";
import { beginLogin, completeLogin } from "./platform/oidc";
import { startAnalytics, capture } from "./platform/palantir";

const desktop = document.getElementById("desktop");
if (!desktop) throw new Error("No desktop.");
const target: HTMLElement = desktop;

// One bundle, two roles. Loaded plainly it is the shell; loaded with ?app= it
// is that app and nothing else, which is what the session opens in a window of
// its own. Same code, same account, different process.
//
// The shell does not open without a signed-in Southbag account: the account
// is the device. An app window does not gate — the service inside it signs in
// for itself.
async function main() {
  const appId = new URLSearchParams(location.search).get("app");

  let loginError: string | null = null;
  let session = null;
  try {
    session = await completeLogin();
  } catch (error) {
    loginError = error instanceof Error ? error.message : String(error);
    history.replaceState(null, "", location.origin + import.meta.env.BASE_URL);
  }
  session ??= currentSession();
  if (session) loginError = null;
  startAnalytics(session?.customer ?? null);
  if (loginError) capture("os_signin_failed");
  if (session) capture("os_session_ready");

  if (appId) {
    mount(AppFrame, { target, props: { appId, customer: session?.customer ?? null } });
    return;
  }

  if (!session) {
    mount(Login, {
      target,
      props: { error: loginError, onsignin: () => { capture("os_signin_begin"); void beginLogin(); } },
    });
    return;
  }

  mount(Desktop, {
    target,
    props: {
      customer: session.customer,
      onsignout: async () => {
        try {
          capture("os_signout_begin");
          await logout();
          location.reload();
        } catch {
          alert("Sign out could not clear this device's account. Please try again.");
        }
      },
    },
  });
}

void main();
