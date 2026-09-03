import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Pages serves this at southbaghq.github.io/os/. Set from the first commit;
// every asset URL in the build depends on it.
export default defineConfig({
  base: "/os/",
  plugins: [svelte()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    reportCompressedSize: true,
    modulePreload: { polyfill: false },
  },
});
