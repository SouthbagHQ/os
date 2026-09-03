<script lang="ts">
  import Wallpaper from "./surfaces/wallpaper/Wallpaper.svelte";
  import Panel from "./surfaces/panel/Panel.svelte";
  import Boot from "./surfaces/boot/Boot.svelte";
  import { sequence } from "./surfaces/boot/sequence.svelte";
  import type { Customer } from "./platform/identity";

  let { customer }: { customer: Customer } = $props();

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
<Panel {customer} />
<Boot {customer} />
