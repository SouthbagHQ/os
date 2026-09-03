<script lang="ts">
  import Window from "./Window.svelte";
  import type { DomWindowHost } from "./host.svelte";
  import { rectForZone, type SnapZone } from "./geometry";
  import { appById } from "../apps/registry";
  import type { Customer } from "../platform/identity";

  let { host, customer }: { host: DomWindowHost; customer: Customer } = $props();

  let armed = $state<SnapZone>("none");
  const preview = $derived(rectForZone(armed, host.area));

  let area = $state<HTMLElement | null>(null);

  // ResizeObserver rather than a viewport query: the work area is whatever
  // this element is, which is the same question the compositor answers with a
  // layer-shell exclusive zone.
  $effect(() => {
    if (!area) return;
    const element = area;
    const observer = new ResizeObserver(() => {
      host.setArea({
        x: 0,
        y: 0,
        width: element.clientWidth,
        height: element.clientHeight,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<div class="area" bind:this={area}>
  {#if preview}
    <div
      class="preview"
      aria-hidden="true"
      style:left="{preview.x}px"
      style:top="{preview.y}px"
      style:width="{preview.width}px"
      style:height="{preview.height}px"
    ></div>
  {/if}

  {#each host.windows as managed (managed.id)}
    {@const app = appById(managed.appId)}
    {#if app}
      <Window window={managed} {host} {app} {customer} onarm={(zone) => (armed = zone)} />
    {/if}
  {/each}
</div>

<style>
  /*
   * The work area excludes the panel, the same way a layer-shell exclusive
   * zone does. Its z-index makes it a stacking context, so window stacking is
   * contained and the panel stays on top of every window.
   */
  .area {
    position: fixed;
    inset: 0 0 var(--panel-height) 0;
    z-index: var(--z-windows);
  }

  .preview {
    position: absolute;
    z-index: 0;
    background: rgba(26, 66, 128, 0.14);
    border: 1px solid var(--sb-accent-border);
    pointer-events: none;
    transition:
      left 120ms var(--ease),
      top 120ms var(--ease),
      width 120ms var(--ease),
      height 120ms var(--ease);
  }
</style>
