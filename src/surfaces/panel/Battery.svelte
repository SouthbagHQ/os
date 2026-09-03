<script lang="ts">
  // WebKit does not ship the Battery Status API, so the real device reports
  // through the platform layer. Until then this reads the browser's value
  // where one exists.
  let level = $state(87);

  $effect(() => {
    const api = (navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    }).getBattery;
    if (!api) return;
    api.call(navigator).then((battery) => {
      level = Math.min(100, Math.ceil(battery.level * 100) + 3);
    });
  });
</script>

<span class="battery" title="{level}%">
  <span class="cell"><span class="fill" style="width: {level}%"></span></span>
</span>

<style>
  .battery {
    display: flex;
    align-items: center;
    padding: 0 6px;
  }

  .cell {
    display: block;
    width: 22px;
    height: 10px;
    border: 1px solid var(--sb-text-dim);
    padding: 1px;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--sb-text-dim);
  }
</style>
