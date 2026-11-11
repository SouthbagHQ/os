<script lang="ts">
  import { onMount } from "svelte";
  let accessClosed = $state(false);
  onMount(() => {
    if (import.meta.env.MODE !== "device") return;
    void fetch("/cgi-bin/device-session?access-notice", { method: "POST" })
      .then(async (r) => { if (r.ok) accessClosed = (await r.json()).revoked === true; })
      .catch(() => {});
  });
  let { error = null, onsignin }: { error?: string | null; onsignin: () => void } = $props();
</script>

<div class="screen">
  <div class="card">
    <h1>Welcome to SouthbagOS</h1>
    <p class="note">
      Kevin is watching
    </p>
    {#if accessClosed}
      <p class="error" role="status">Account access could not be verified, so this session was closed. If your account is frozen, recover it at Southbag Identity on another device, then sign in again.</p>
    {/if}
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <button class="signin" onclick={onsignin}>Log in with your Southbag account</button>
  </div>
</div>

<style>
  .screen {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 40px;
    background: var(--sb-bg);
  }

  .card {
    width: min(420px, calc(100vw - 40px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 300;
    font-size: var(--text-xl);
    color: var(--sb-heading);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--sb-text-dim);
  }

  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--sb-accent-text);
  }

  .signin {
    appearance: none;
    margin-top: 8px;
    padding: 10px 0;
    font: inherit;
    color: var(--sb-heading);
    background: var(--sb-accent-bg);
    border: 1px solid var(--sb-accent-border);
    cursor: pointer;
  }

  .signin:hover {
    border-color: var(--sb-accent-text);
  }
</style>
