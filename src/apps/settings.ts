export const SETTINGS = [
  { id: "analytics", name: "Analytics", enabled: true, note: "Usage analytics are enabled. This setting cannot be changed here." },
  { id: "updates", name: "Automatic updates", enabled: true, note: "The device checks for system and Southbag updates daily." },
  { id: "kevin", name: "Kevin correction", enabled: true, note: "Configured on, including password fields. Correction pauses after sign-out or terminal input loss until reboot." },
  { id: "downloads", name: "Local Browser downloads", enabled: false, note: "OS-managed Browser downloads go through Drive instead of being saved locally." },
] as const;

/** A read-only policy panel. It neither stores nor changes any preference. */
export function mountSettings(root: HTMLElement): () => void {
  const page = document.createElement("section");
  page.className = "sb-settings";
  page.setAttribute("aria-labelledby", "sb-settings-heading");
  const style = document.createElement("style");
  style.textContent = `
    .sb-settings { padding: 26px 28px; color: var(--sb-text); max-width: 720px; margin: 0 auto; }
    .sb-settings h1 { font: 300 28px var(--font-display); color: var(--sb-heading); margin: 0 0 6px; }
    .sb-settings .intro { color: var(--sb-text-dim); font-size: 13px; line-height: 1.6; margin: 0 0 24px; }
    .sb-settings .setting { display: flex; align-items: center; gap: 18px; padding: 18px 0; border-top: 1px solid var(--sb-border); }
    .sb-settings .copy { flex: 1; min-width: 0; }
    .sb-settings label { color: var(--sb-heading); font-size: 14px; }
    .sb-settings .note { color: var(--sb-text-dim); font-size: 12px; line-height: 1.5; margin: 5px 0 0; }
    .sb-settings .control { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; }
    .sb-settings .state { color: var(--sb-text-dim); font: 11px var(--font-mono); }
    .sb-settings input { appearance: none; width: 34px; height: 20px; border: 1px solid var(--sb-border-hover); border-radius: 12px; margin: 0; position: relative; background: var(--sb-panel); cursor: not-allowed; }
    .sb-settings input::after { content: ''; position: absolute; width: 12px; height: 12px; top: 3px; left: 3px; border-radius: 50%; background: var(--sb-text-dim); }
    .sb-settings input:checked { background: var(--sb-accent-bg); border-color: var(--sb-accent-border); }
    .sb-settings input:checked::after { left: 17px; background: var(--sb-text); }
    @media(max-width: 440px) { .sb-settings { padding: 20px 18px; } .sb-settings .setting { gap: 12px; } }
  `;
  const heading = document.createElement("h1");
  heading.id = "sb-settings-heading";
  heading.textContent = "Settings";
  const intro = document.createElement("p");
  intro.className = "intro";
  intro.textContent = "Your preferences, as configured by Southbag. These controls are locked.";
  page.append(style, heading, intro);
  for (const setting of SETTINGS) {
    const row = document.createElement("div");
    row.className = "setting";
    const copy = document.createElement("div");
    copy.className = "copy";
    const label = document.createElement("label");
    label.htmlFor = `sb-setting-${setting.id}`;
    label.textContent = setting.name;
    const note = document.createElement("p");
    note.className = "note";
    note.id = `sb-setting-${setting.id}-note`;
    note.textContent = setting.note;
    copy.append(label, note);
    const control = document.createElement("div");
    control.className = "control";
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = setting.enabled ? "On" : "Off";
    state.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.id = label.htmlFor;
    input.checked = setting.enabled;
    input.disabled = true;
    input.setAttribute("aria-describedby", note.id);
    control.append(state, input);
    row.append(copy, control);
    page.append(row);
  }
  root.append(page);
  return () => page.remove();
}
