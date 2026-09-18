import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import type { ManifestV3Export } from "@crxjs/vite-plugin";
import baseManifest from "./manifest.json";

/**
 * Firefox runs the same MV3 code, but two manifest keys have to differ:
 *
 * - no service workers (Firefox bug 1573659) — the background bundle runs as
 *   an event page instead, which is the same file under `scripts`;
 * - AMO requires a stable extension id under `browser_specific_settings`.
 *
 * Everything else — the version above all — comes from the one manifest.json,
 * so the two builds can't drift apart.
 */
function firefoxManifest(): ManifestV3Export {
  const { background, ...rest } = baseManifest;
  return {
    ...rest,
    background: { scripts: [background.service_worker], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: "better-bandcamp@walidvb.com",
        // The floor is really 112 (`background.type: "module"`), but AMO makes
        // every extension declare what data it collects, and that key only
        // exists from 140 — which is the current ESR anyway.
        strict_min_version: "140.0",
        // This extension collects nothing — see PRIVACY.md.
        data_collection_permissions: { required: ["none"] },
      },
    },
  } as ManifestV3Export;
}

export default defineConfig(({ mode }) => {
  const firefox = mode === "firefox";

  return {
    plugins: [
      react(),
      crx({
        manifest: firefox ? firefoxManifest() : (baseManifest as ManifestV3Export),
        browser: firefox ? "firefox" : "chrome",
        // crxjs's default content script is a tiny loader that dynamically
        // imports the real module. Firefox's dynamic import inside an MV3
        // content script is still unreliable (Firefox bug 1803950), so the
        // Firefox build inlines the whole thing into one plain script.
        ...(firefox ? { contentScripts: { standaloneFiles: ["src/content/listenAll.ts"] } } : {}),
      }),
    ],
    build: {
      outDir: firefox ? "dist/firefox" : "dist/chrome",
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
  };
});
