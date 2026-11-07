<script lang="ts">
  /**
   * Southbag Browser, the web app.
   *
   * The standalone Browser product is an Electron desktop application
   * (SouthbagHQ/browser). This is the OS's browser as a web app: a top-level
   * window with a location bar that becomes the site it visits — no frames,
   * no embedding, the page itself goes where the customer sends it. Back
   * returns here. Every service app on the OS opens through this window, so
   * "the browser" is one thing everywhere, on the device and off.
   */
  import { APPS } from "./registry";
  import { normalizeUrl } from "./url";

  let { go = null }: { go?: string | null } = $props();

  let address = $state("");

  $effect(() => {
    if (!go) return;
    const url = normalizeUrl(go);
    if (url) {
      address = url;
      location.assign(url);
    }
  });

  function navigate(event: SubmitEvent) {
    event.preventDefault();
    const url = normalizeUrl(address);
    if (url) location.assign(url);
  }

  const services = APPS.filter((app) => app.url);
</script>

<div class="page">
  <form class="bar" onsubmit={navigate}>
    <span class="word">Southbag Browser</span>
    <input
      type="text"
      bind:value={address}
      placeholder="Address"
      spellcheck="false"
      autocomplete="off"
      aria-label="Address"
    />
    <button type="submit">Go</button>
  </form>

  <div class="start">
    <h1>Where to?</h1>
    <p class="note">The window becomes the site. Back brings you here.</p>
    <ul class="services">
      {#each services as app (app.id)}
        <li><a href={app.url}>{app.name}</a></li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--sb-bg);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--sb-panel);
    border-bottom: 1px solid var(--sb-border);
  }

  .word {
    font-size: var(--text-sm);
    color: var(--sb-heading);
    white-space: nowrap;
  }

  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--text-sm);
    padding: 6px 10px;
    color: var(--sb-text);
    background: var(--sb-bg);
    border: 1px solid var(--sb-border);
  }

  .bar button {
    appearance: none;
    font: inherit;
    font-size: var(--text-sm);
    padding: 6px 14px;
    color: var(--sb-heading);
    background: var(--sb-accent-bg);
    border: 1px solid var(--sb-accent-border);
    cursor: pointer;
  }

  .start {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
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

  .services {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 240px;
  }

  .services a {
    display: block;
    padding: 8px 14px;
    font-size: var(--text-sm);
    color: var(--sb-text);
    text-decoration: none;
    background: var(--sb-card);
    border: 1px solid var(--sb-border);
  }

  .services a:hover {
    background: var(--sb-card-hover);
    border-color: var(--sb-border-hover);
    color: var(--sb-heading);
  }
</style>
