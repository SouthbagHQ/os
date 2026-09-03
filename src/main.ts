import "./styles/tokens.css";
import "./styles/base.css";
import { mount } from "svelte";
import Desktop from "./Desktop.svelte";
import AppFrame from "./AppFrame.svelte";
import { seededIdentity } from "./platform/identity";

const target = document.getElementById("desktop");
if (!target) throw new Error("No desktop.");

const customer = seededIdentity().current();

// One bundle, two roles. Loaded plainly it is the shell; loaded with ?app= it
// is that app and nothing else, which is what the session opens in a window of
// its own. Same code, same account, different process.
const appId = new URLSearchParams(location.search).get("app");

if (appId) {
  mount(AppFrame, { target, props: { appId, customer } });
} else {
  mount(Desktop, { target, props: { customer } });
}
