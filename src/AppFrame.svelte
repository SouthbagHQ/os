<script lang="ts">
  import { appById } from "./apps/registry";
  import type { AppContext } from "./apps/types";
  import type { Customer } from "./platform/identity";

  let { appId, customer }: { appId: string; customer: Customer } = $props();

  const app = $derived(appById(appId));
  let root = $state<HTMLElement | null>(null);

  // On the device this page is the whole window, and the compositor drew the
  // frame around it. There is no shell chrome here because there is no shell
  // in this process.
  $effect(() => {
    if (!root || !app?.mount) return;
    const context: AppContext = {
      customer,
      window: {
        setTitle: (title) => (document.title = title),
        close: () => window.close(),
      },
    };
    return app.mount(root, context) ?? undefined;
  });

  $effect(() => {
    document.title = app?.name ?? "Southbag";
  });
</script>

{#if !app}
  <div class="pending">
    <p class="name">Not found</p>
    <p class="note">This device has no app by that name.</p>
  </div>
{:else if !app.mount}
  <div class="pending">
    <p class="name">{app.name}</p>
    <p class="note">Not yet on this device.</p>
  </div>
{:else}
  <div class="root" bind:this={root}></div>
{/if}

<style>
  .root {
    height: 100vh;
    overflow: auto;
    background: var(--sb-card);
  }

  .pending {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--sb-card);
  }

  .name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 300;
    color: var(--sb-heading);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--sb-text-dim);
  }
</style>
