<script lang="ts">
  import { sequence } from "./sequence.svelte";
  import { createClock, timeOfDay } from "../../platform/clock.svelte";
  import type { Customer } from "../../platform/identity";
  import { firstName } from "../../platform/identity";

  let { customer }: { customer: Customer } = $props();

  const clock = createClock();
  const greeting = $derived(
    `Good ${timeOfDay(clock.now)}, ${firstName(customer)}.`,
  );

  const visible = $derived(sequence.atLeast("mark"));
  const travelling = $derived(sequence.atLeast("reveal"));
  const landed = $derived(sequence.atLeast("land"));
  const greeted = $derived(sequence.atLeast("greeting"));

  // Development only: ?boot=N stretches the travel to match the stretched
  // beats, so the flight can be watched. 1 in production.
  const stretch = import.meta.env.DEV
    ? Number(new URLSearchParams(location.search).get("boot")) || 1
    : 1;

  let dismissed = $state(false);

  // The greeting leaves when you arrive. If you do nothing, it stays.
  $effect(() => {
    if (!greeted) return;
    const go = () => (dismissed = true);
    const options = { once: true, passive: true } as const;
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const event of events) addEventListener(event, go, options);
    return () => {
      for (const event of events) removeEventListener(event, go);
    };
  });
</script>

<div class="curtain" class:lifted={travelling} aria-hidden="true"></div>

{#if !greeted}
  <div
    class="mark"
    class:visible
    class:travelling
    class:landed
    style:--travel="{620 * stretch}ms"
    style:--fade-in="{400 * stretch}ms"
  >
    Southbag
  </div>
{/if}

<p class="greeting" class:shown={greeted && !dismissed} aria-live="polite">
  <span class="line">{greeting}</span>
  <span class="under">Everything is where you left it.</span>
</p>

<style>
  .curtain {
    position: fixed;
    inset: 0;
    z-index: var(--z-boot);
    background: var(--sb-bg);
    opacity: 1;
    transition: opacity 500ms var(--ease);
    pointer-events: none;
  }

  .curtain.lifted {
    opacity: 0;
  }

  /*
   * The mark starts centred and ends as the panel launcher. One continuous
   * transform, resolved entirely in CSS from the shared panel tokens.
   *
   * transform-origin is the left edge at mid-height, so the scale pins the
   * word's left edge and vertical centre — which is what has to line up with
   * the launcher. Percentages in translate resolve against the element's own
   * box, so no text measurement is needed either.
   */
  .mark {
    position: fixed;
    left: 0;
    top: 0;
    z-index: calc(var(--z-boot) + 1);
    transform-origin: 0 50%;
    transform: translate(calc(50vw - 50%), calc(50vh - 50%));
    font-family: var(--font-display);
    font-weight: 300;
    font-size: calc(var(--boot-mark-size) * 1px);
    line-height: 1;
    letter-spacing: 0.01em;
    color: var(--sb-heading);
    opacity: 0;
    transition:
      opacity var(--fade-in) var(--ease),
      transform var(--travel) var(--ease);
    will-change: transform, opacity;
    pointer-events: none;
  }

  .mark.travelling {
    transform: translate(
        var(--launcher-word-x),
        calc(100vh - var(--panel-height) / 2 - 50%)
      )
      scale(calc(var(--launcher-word-size) / var(--boot-mark-size)));
  }

  .mark.visible {
    opacity: 1;
  }

  /* Crosses over with the crisp panel launcher as the travel ends. */
  .mark.landed {
    opacity: 0;
    transition:
      opacity 160ms var(--ease),
      transform var(--travel) var(--ease);
  }

  .greeting {
    position: fixed;
    left: 50%;
    /* Centred in the space above the panel, not in the screen. */
    top: calc(50% - var(--panel-height) / 2);
    z-index: var(--z-greeting);
    translate: -50% -50%;
    margin: 0;
    /* Not a ch cap: this element's font is the body face, not the display
       face the greeting is set in, so ch here is far narrower than it looks. */
    max-width: min(88vw, 620px);
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 700ms var(--ease),
      transform 700ms var(--ease);
    pointer-events: none;
  }

  .greeting.shown {
    opacity: 1;
    transform: translateY(0);
  }

  .line {
    font-family: var(--font-display);
    font-weight: 300;
    /* Degrades on a narrow viewport rather than being redesigned for one. */
    font-size: clamp(26px, 4.4vw, 42px);
    line-height: 1.1;
    letter-spacing: 0.01em;
    color: var(--sb-heading);
  }

  .under {
    font-size: clamp(var(--text-sm), 1.4vw, var(--text-md));
    color: var(--sb-text-dim);
  }
</style>
