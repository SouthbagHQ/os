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

  let { customer }: { customer: Customer } = $props();

  // On the device the compositor owns windows, so opening an app starts a
  // process rather than drawing a frame. In a browser there is no compositor,
  // so the shell draws them itself. Everything downstream sees one interface.
  const onDevice = import.meta.env.MODE === "device";
  const host = onDevice ? new CogWindowHost() : new DomWindowHost();
  const drawnHost = $derived(host instanceof DomWindowHost ? host : null);
  let launcherOpen = $state(false);

  function openApp(id: string) {
    const app = appById(id);
    if (!app) return;
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
/>
<Boot {customer} />
