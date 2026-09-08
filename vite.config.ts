import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // MV3 extension pages can't use cross-world modulepreload — crxjs's known
    // quirk, harmless (scripts still load fine) but noisy in devtools.
    modulePreload: false,
    rollupOptions: {
      input: {
        grid: "src/grid/index.html",
        label: "src/label/index.html",
        welcome: "src/welcome/index.html",
      },
    },
  },
});
