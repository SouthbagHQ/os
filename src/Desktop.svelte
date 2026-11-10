<script lang="ts">
  import Wallpaper from "./surfaces/wallpaper/Wallpaper.svelte";
  import Panel from "./surfaces/panel/Panel.svelte";
  import Boot from "./surfaces/boot/Boot.svelte";
  import Launcher from "./surfaces/launcher/Launcher.svelte";
  import Windows from "./wm/Windows.svelte";
  import { DomWindowHost } from "./wm/host.svelte";
  import { CogWindowHost } from "./wm/cog-host.svelte";
  import { appById } from "./apps/registry";
  import { sequence } from "./surfaces/boot/sequence.svelte";
  import type { Customer } from "./platform/identity";

  let { customer, onsignout }: { customer: Customer; onsignout: () => void } = $props();

  // On the device the compositor owns windows, so opening an app starts a
  // process rather than drawing a frame. In a browser there is no compositor,
  // so the shell draws them itself. Everything downstream sees one interface.
  const onDevice = import.meta.env.MODE === "device";
  const host = onDevice ? new CogWindowHost() : new DomWindowHost();
  const drawnHost = $derived(host instanceof DomWindowHost ? host : null);
  const deviceHost = $derived(host instanceof CogWindowHost ? host : null);
  let launcherOpen = $state(false);
  let lockMessage = $state<string | null>(null);

  /**
   * The compositor owns the lock; the shell just asks for it. It can refuse:
   * offline (unlock only works online), or nothing signed in to protect.
   * A refusal is said out loud rather than leaving a desktop that looks
   * locked but is not.
   */
  async function lock() {
    if (!onDevice) return;
    lockMessage = null;
    try {
      const response = await fetch("/cgi-bin/lock", { method: "POST" });
      if (!response.ok) {
        lockMessage = (await response.text()).trim() || "Lock unavailable.";
      }
    } catch {
      lockMessage = "Lock unavailable on this device.";
    }
  }

  function openApp(id: string) {
    const app = appById(id);
    if (!app) return;
    // Services and the Browser are top-level windows, not frames: off the
    // device that is a new browser window, on the device the session starts
    // a cog process (which the launcher routes the same way).
    if (!onDevice && (app.url || app.id === "browser")) {
      const go = app.url ? `&go=${encodeURIComponent(app.url)}` : "";
      window.open(`${import.meta.env.BASE_URL}?app=browser${go}`, "_blank", "noopener");
      launcherOpen = false;
      return;
    }
    host.open(id, { title: app.name, size: app.size, min: app.min });
    launcherOpen = false;
  }

  // Four surfaces, composed here and nowhere else. Under labwc each of these
  // is a separate layer-shell client; this file is the only thing that has to
  // know they currently share a page.
  $effect(() => sequence.run());

  // Development only: lets the boot geometry be checked from the console.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__sequence = sequence;
  }
</script>

<Wallpaper />
{#if drawnHost}
  <Windows host={drawnHost} {customer} />
{/if}
<Panel
  {customer}
  {host}
  {launcherOpen}
  ontogglelauncher={() => (launcherOpen = !launcherOpen)}
/>
<Launcher
  open={launcherOpen}
  onopen={openApp}
  onclose={() => (launcherOpen = false)}
  onlock={() => {
    launcherOpen = false;
    void lock();
  }}
  {onsignout}
/>
{#if deviceHost?.failed}
  <div class="lock-message" role="alert">Could not open {appById(deviceHost.failed)?.name ?? "app"}. Please try again.</div>
{/if}
{#if lockMessage}
  <div class="lock-message" role="alert">{lockMessage}</div>
{/if}
<Boot {customer} />

<style>
  .lock-message {
    position: fixed;
    left: 50%;
    bottom: calc(var(--panel-height) + 16px);
    transform: translateX(-50%);
    z-index: calc(var(--z-launcher) + 2);
    padding: 8px 16px;
    font-size: var(--text-sm);
    color: var(--sb-accent-text);
    background: var(--sb-panel);
    border: 1px solid var(--sb-border);
  }
</style>
