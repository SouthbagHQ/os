<script lang="ts">
  import { sequence } from "../boot/sequence.svelte";
  import { createClock, formatTime } from "../../platform/clock.svelte";
  import type { Customer } from "../../platform/identity";
  import { firstName } from "../../platform/identity";
  import Battery from "./Battery.svelte";
  import type { WindowHost } from "../../wm/host.svelte";
  import { appById } from "../../apps/registry";

  let {
    customer,
    host,
    launcherOpen,
    ontogglelauncher,
  }: {
    customer: Customer;
    host: WindowHost;
    launcherOpen: boolean;
    ontogglelauncher: () => void;
  } = $props();

  const clock = createClock();
  const shown = $derived(sequence.atLeast("panel"));
  const markVisible = $derived(sequence.atLeast("land"));

</script>

<div class="panel" class:shown>
  <button
    class="launcher"
    class:visible={markVisible}
    aria-expanded={launcherOpen}
    onclick={ontogglelauncher}
  >
    <span class="pip" aria-hidden="true"></span>
    <span class="word">Southbag</span>
  </button>

  <div class="windows">
    {#each host.windows as managed (managed.id)}
      <button
        class="task"
        class:active={host.focusedId === managed.id}
        aria-current={host.focusedId === managed.id}
        onclick={() =>
          host.focusedId === managed.id
            ? host.toggleMinimise(managed.id)
            : (managed.minimised
                ? host.toggleMinimise(managed.id)
                : host.focus(managed.id))}
      >
        {appById(managed.appId)?.name ?? managed.title}
      </button>
    {/each}
  </div>

  <div class="status">
    <span class="clock">{formatTime(clock.now)}</span>
    <Battery />
    <button class="account">{firstName(customer)}</button>
  </div>
</div>

<style>
  .panel {
    position: fixed;
    inset: auto 0 0 0;
    z-index: var(--z-panel);
    height: var(--panel-height);
    display: flex;
    align-items: stretch;
    gap: 8px;
    padding: 0 var(--panel-pad-x);
    background: var(--sb-panel);
    border-top: 1px solid var(--sb-border);
    transform: translateY(100%);
    transition: transform 420ms var(--ease);
    will-change: transform;
  }

  .panel.shown {
    transform: translateY(0);
    will-change: auto;
  }

  button {
    appearance: none;
    background: none;
    border: none;
    color: var(--sb-text-dim);
    font: inherit;
    font-size: var(--text-sm);
    padding: 0 var(--launcher-pad-x);
    cursor: default;
    transition: color 120ms var(--ease);
  }

  button:hover {
    color: var(--sb-heading);
  }

  .launcher {
    display: flex;
    align-items: center;
    gap: var(--launcher-gap);
    color: var(--sb-heading);
    /* Held back until the boot mark has finished travelling into this slot. */
    opacity: 0;
    transition: opacity 160ms var(--ease);
  }

  .launcher.visible {
    opacity: 1;
  }

  .word {
    font-size: calc(var(--launcher-word-size) * 1px);
  }

  .pip {
    width: var(--launcher-pip);
    height: var(--launcher-pip);
    background: var(--sb-accent-text);
  }

  .windows {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: 1px;
    padding: 6px 8px;
    min-width: 0;
  }

  .task {
    display: flex;
    align-items: center;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    /* The rule under a task encodes which window has focus. Nothing else. */
    border-bottom: 1px solid transparent;
  }

  .task.active {
    color: var(--sb-heading);
    border-bottom-color: var(--sb-accent-text);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .clock {
    font-size: var(--text-sm);
    color: var(--sb-text);
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
  }
</style>
