import "./styles/tokens.css";
import "./styles/base.css";
import { mount } from "svelte";
import Desktop from "./Desktop.svelte";
import { seededIdentity } from "./platform/identity";

const target = document.getElementById("desktop");
if (!target) throw new Error("No desktop.");

mount(Desktop, {
  target,
  props: { customer: seededIdentity().current() },
});
