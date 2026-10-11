import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icon.svg",
        "icon-192.png",
        "icon-512.png",
        "THIRD-PARTY-NOTICES.txt",
      ],
      manifest: {
        name: "AirFuel Kitchen",
        short_name: "AirFuel",
        description: "Good food. More protein. Less fuss.",
        theme_color: "#b94a2f",
        background_color: "#f8f7f3",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,webp,png,woff2,json}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "recipes-savoury", test: /recipes-savoury\.json$/ },
            { name: "recipes-plant", test: /recipes-plant\.json$/ },
            // Keeps the Supabase SDK out of the shared vendor chunk, so it stays
            // off the first-load path once Settings is lazy-loaded (see PERFORMANCE_AUDIT.md).
            { name: "supabase", test: /node_modules\/@supabase\//, maxSize: 400_000 },
            // Fewer first-load requests (18 before this change, 12 now).
            { name: "vendor", test: /node_modules/, maxSize: 2_000_000 },
          ],
        },
      },
    },
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
