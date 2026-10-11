import { createHash } from "node:crypto";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Production-only Content-Security-Policy (SEC-10). Inline scripts left in the final
// HTML (the pre-paint theme script) are allowed by hash, so editing them stays safe.
// The dev server is untouched because Vite injects its own inline preamble there.
// frame-ancestors cannot be set from a <meta> tag: send it as a hosting header
// (see docs/backend/SECURITY_AUDIT.md).
function contentSecurityPolicy(cloudUrl: string | undefined): Plugin {
  return {
    name: "airfuel-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [
          ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
        ]
          .map(([, body]) => body)
          .filter((body) => body.trim())
          .map(
            (body) =>
              `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
          );
        let cloud = "";
        if (cloudUrl) {
          const { origin, host } = new URL(cloudUrl);
          cloud = ` ${origin} wss://${host}`;
        }
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(" ")}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          `connect-src 'self'${cloud}`,
          "worker-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; ");
        return html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    contentSecurityPolicy(
      loadEnv(mode, process.cwd(), "VITE_").VITE_SUPABASE_URL,
    ),
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
            {
              name: "supabase",
              test: /node_modules\/@supabase\//,
              maxSize: 400_000,
            },
            // Fewer first-load requests (18 before this change, 12 now).
            { name: "vendor", test: /node_modules/, maxSize: 2_000_000 },
          ],
        },
      },
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Several suites boot an embedded Postgres (PGlite). Generous budgets keep the
    // suite deterministic on a loaded machine; assertions are unchanged.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
}));
