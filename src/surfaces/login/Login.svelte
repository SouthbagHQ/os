<script lang="ts">
  let { error = null, onsignin }: { error?: string | null; onsignin: () => void } = $props();
</script>

<div class="screen">
  <p class="mark">Southbag</p>
  <div class="card">
    <h1>This device belongs to a Southbag account.</h1>
    <p class="note">
      Sign in with Southbag Identity&trade;. You will be sent to
      identity.southbag.cc and brought back.
    </p>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <button class="signin" onclick={onsignin}>Sign in with Southbag ID&trade;</button>
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

  .mark {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 300;
    font-size: 38px;
    color: var(--sb-heading);
  }

  .card {
    width: 340px;
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
