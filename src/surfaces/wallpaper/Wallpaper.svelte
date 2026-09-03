<script lang="ts">
  import { sequence } from "../boot/sequence.svelte";

  const shown = $derived(sequence.atLeast("reveal"));
</script>

<!--
  The institution's own 48px grid, full bleed. Not a photograph, not a
  gradient: zero bytes, instant paint, and free on a 2013 integrated GPU.
-->
<div class="wallpaper" class:shown aria-hidden="true"></div>

<style>
  .wallpaper {
    position: fixed;
    inset: 0;
    z-index: var(--z-wallpaper);
    background-color: var(--sb-bg);
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
    background-size: 48px 48px;
    background-position: center center;
    opacity: 0;
    transform: scale(1.02);
    transition:
      opacity 500ms var(--ease),
      transform 900ms var(--ease);
    will-change: transform;
  }

  .wallpaper.shown {
    opacity: 1;
    transform: scale(1);
    will-change: auto;
  }
</style>
