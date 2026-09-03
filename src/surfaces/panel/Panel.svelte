<script lang="ts">
  import { sequence } from "../boot/sequence.svelte";
  import { createClock, formatTime } from "../../platform/clock.svelte";
  import type { Customer } from "../../platform/identity";
  import { firstName } from "../../platform/identity";
  import Battery from "./Battery.svelte";

  let { customer }: { customer: Customer } = $props();

  const clock = createClock();
  const shown = $derived(sequence.atLeast("panel"));
  const markVisible = $derived(sequence.atLeast("land"));

</script>

<div class="panel" class:shown>
  <button class="launcher" class:visible={markVisible}>
    <span class="pip" aria-hidden="true"></span>
    <span class="word">Southbag</span>
  </button>

  <div class="windows"></div>

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
    align-items: center;
    gap: 2px;
    margin: 8px 4px;
    padding: 0 8px;
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
