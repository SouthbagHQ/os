<script lang="ts">
  import { APPS } from "../../apps/registry";

  let { open, onopen, onclose }: {
    open: boolean;
    onopen: (appId: string) => void;
    onclose: () => void;
  } = $props();

  let panel = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!open || !panel) return;
    panel.querySelector<HTMLElement>("button")?.focus();
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scrim" onpointerdown={onclose}></div>
  <div class="launcher" bind:this={panel}>
    <ul class="list">
      {#each APPS as app (app.id)}
        <li>
          <button onclick={() => onopen(app.id)}>{app.name}</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-launcher);
  }

  .launcher {
    position: fixed;
    left: var(--panel-pad-x);
    bottom: calc(var(--panel-height) + 8px);
    z-index: calc(var(--z-launcher) + 1);
    width: 232px;
    background: var(--sb-panel);
    border: 1px solid var(--sb-border);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    padding: 6px 0;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  button {
    appearance: none;
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--sb-text);
    padding: 7px 16px;
    cursor: default;
  }

  button:hover {
    background: var(--sb-card-hover);
    color: var(--sb-heading);
  }
</style>
