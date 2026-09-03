<script lang="ts">
  import type { ManagedWindow, WindowHost } from "./host.svelte";
  import { resizeRect, snapZoneFor, type ResizeEdge, type SnapZone } from "./geometry";
  import type { AppContext, AppManifest } from "../apps/types";
  import type { Customer } from "../platform/identity";

  let {
    window: managed,
    host,
    app,
    customer,
    onarm,
  }: {
    window: ManagedWindow;
    host: WindowHost;
    app: AppManifest;
    customer: Customer;
    onarm: (zone: SnapZone) => void;
  } = $props();

  const focused = $derived(host.focusedId === managed.id);

  let frame = $state<HTMLElement | null>(null);
  let content = $state<HTMLElement | null>(null);

  // Apps are mounted into a plain DOM node, once, and torn down on close.
  $effect(() => {
    if (!content || !app.mount) return;
    const context: AppContext = {
      customer,
      window: {
        setTitle: (title) => host.setTitle(managed.id, title),
        close: () => host.close(managed.id),
      },
    };
    return app.mount(content, context) ?? undefined;
  });

  /**
   * Drag and resize write straight to the element and commit to state once, on
   * release. A state write per pointer move would re-run reactivity and force
   * layout sixty times a second for no benefit.
   */
  function beginDrag(event: PointerEvent) {
    if (event.button !== 0 || !frame) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;

    host.focus(managed.id);
    const element = frame;
    const startRect = { ...managed.rect };
    const startX = event.clientX;
    const startY = event.clientY;
    let dx = 0;
    let dy = 0;
    let zone: SnapZone = "none";

    element.setPointerCapture(event.pointerId);
    element.classList.add("dragging");

    const move = (e: PointerEvent) => {
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      const next = snapZoneFor({ x: e.clientX, y: e.clientY }, host.area);
      if (next !== zone) {
        zone = next;
        onarm(zone);
      }
    };

    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      element.classList.remove("dragging");
      element.style.transform = "";
      onarm("none");

      if (zone !== "none") {
        host.snapTo(managed.id, zone);
      } else {
        host.setRect(managed.id, {
          ...startRect,
          x: startRect.x + dx,
          y: startRect.y + dy,
        });
      }
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }

  function beginResize(event: PointerEvent, edge: ResizeEdge) {
    if (event.button !== 0 || !frame) return;
    event.stopPropagation();

    host.focus(managed.id);
    const element = frame;
    const startRect = { ...managed.rect };
    const startX = event.clientX;
    const startY = event.clientY;
    let next = startRect;

    element.setPointerCapture(event.pointerId);
    element.classList.add("dragging");

    const move = (e: PointerEvent) => {
      next = resizeRect(
        startRect,
        edge,
        e.clientX - startX,
        e.clientY - startY,
        managed.min,
      );
      element.style.left = `${next.x}px`;
      element.style.top = `${next.y}px`;
      element.style.width = `${next.width}px`;
      element.style.height = `${next.height}px`;
    };

    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      element.classList.remove("dragging");
      element.style.removeProperty("left");
      element.style.removeProperty("top");
      element.style.removeProperty("width");
      element.style.removeProperty("height");
      host.setRect(managed.id, next);
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }

  function onKeydown(event: KeyboardEvent) {
    // Keyboard equivalents for everything the pointer can do to a window.
    if (!event.altKey) return;
    const zones: Record<string, SnapZone> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "maximise",
      ArrowDown: "none",
    };
    const zone = zones[event.key];
    if (!zone) return;
    event.preventDefault();
    host.snapTo(managed.id, zone);
  }

  const EDGES: { edge: ResizeEdge; label: string }[] = [
    { edge: "n", label: "top edge" },
    { edge: "s", label: "bottom edge" },
    { edge: "e", label: "right edge" },
    { edge: "w", label: "left edge" },
    { edge: "ne", label: "top right corner" },
    { edge: "nw", label: "top left corner" },
    { edge: "se", label: "bottom right corner" },
    { edge: "sw", label: "bottom left corner" },
  ];
</script>

<!--
  A window is an interactive surface, not a passive region: it takes focus so
  that the keyboard equivalents below apply to the window the customer is
  actually in.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="frame"
  tabindex="-1"
  class:focused
  bind:this={frame}
  style:left="{managed.rect.x}px"
  style:top="{managed.rect.y}px"
  style:width="{managed.rect.width}px"
  style:height="{managed.rect.height}px"
  style:z-index={managed.z}
  hidden={managed.minimised}
  aria-label={managed.title}
  onpointerdowncapture={() => host.focus(managed.id)}
  onkeydown={onKeydown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="bar" onpointerdown={beginDrag} ondblclick={() => host.toggleMaximise(managed.id)}>
    <h1 class="title">{managed.title}</h1>
    <div class="controls">
      <button
        class="control"
        aria-label="Minimise"
        onclick={() => host.toggleMinimise(managed.id)}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" /></svg>
      </button>
      <button
        class="control"
        aria-label={managed.zone === "maximise" ? "Restore" : "Maximise"}
        onclick={() => host.toggleMaximise(managed.id)}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5h7v7h-7z" /></svg>
      </button>
      <button class="control" aria-label="Close" onclick={() => host.close(managed.id)}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
      </button>
    </div>
  </header>

  <div class="content" bind:this={content}>
    {#if !app.mount}
      <div class="pending">
        <p class="pending-name">{app.name}</p>
        <p class="pending-note">Not yet on this device.</p>
      </div>
    {/if}
  </div>

  {#each EDGES as { edge, label } (edge)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="grip grip-{edge}"
      aria-label="Resize {label}"
      onpointerdown={(event) => beginResize(event, edge)}
    ></div>
  {/each}
</section>

<style>
  .frame {
    position: absolute;
    display: flex;
    flex-direction: column;
    background: var(--sb-card);
    border: 1px solid var(--sb-border);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
    overflow: hidden;
    transition:
      left 160ms var(--ease),
      top 160ms var(--ease),
      width 160ms var(--ease),
      height 160ms var(--ease);
  }

  /* Nothing eases while a pointer is driving it. */
  .frame:global(.dragging) {
    transition: none;
    will-change: transform;
  }

  .frame.focused {
    border-color: var(--sb-border-hover);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    flex: none;
    padding: 0 4px 0 12px;
    background: var(--sb-panel);
    border-bottom: 1px solid var(--sb-border);
    touch-action: none;
  }

  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--sb-text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .frame.focused .title {
    color: var(--sb-heading);
  }

  .controls {
    display: flex;
    flex: none;
  }

  .control {
    appearance: none;
    background: none;
    border: none;
    width: 28px;
    height: 24px;
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--sb-text-dimmer);
    cursor: default;
    transition: color 120ms var(--ease);
  }

  .control:hover {
    color: var(--sb-heading);
  }

  .control svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .pending {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .pending-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 300;
    color: var(--sb-heading);
  }

  .pending-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--sb-text-dim);
  }

  /* Resize handles. Eight, wider than they look, as a real product would. */
  .grip {
    position: absolute;
    touch-action: none;
  }

  .grip-n,
  .grip-s {
    left: 8px;
    right: 8px;
    height: 6px;
    cursor: ns-resize;
  }

  .grip-e,
  .grip-w {
    top: 8px;
    bottom: 8px;
    width: 6px;
    cursor: ew-resize;
  }

  .grip-n { top: -3px; }
  .grip-s { bottom: -3px; }
  .grip-e { right: -3px; }
  .grip-w { left: -3px; }

  .grip-ne,
  .grip-nw,
  .grip-se,
  .grip-sw {
    width: 12px;
    height: 12px;
  }

  .grip-nw { top: -3px; left: -3px; cursor: nwse-resize; }
  .grip-se { bottom: -3px; right: -3px; cursor: nwse-resize; }
  .grip-ne { top: -3px; right: -3px; cursor: nesw-resize; }
  .grip-sw { bottom: -3px; left: -3px; cursor: nesw-resize; }
</style>
