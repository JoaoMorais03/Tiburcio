// vite.config.ts — Vite configuration with Tailwind CSS v4, Vue, auto-imports, PWA, and API proxy.

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import VueDevtools from "vite-plugin-vue-devtools";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      imports: ["vue", "vue-router", "pinia", "@vueuse/core"],
      dirs: ["src/stores"],
      dts: "auto-imports.d.ts",
    }),
    Components({
      dirs: ["src/components/ui", "src/components/chat"],
      dts: "components.d.ts",
    }),
    VueDevtools(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "Tiburcio",
        short_name: "Tiburcio",
        description: "AI-powered codebase knowledge assistant",
        theme_color: "#121212",
        background_color: "#121212",
        display: "standalone",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^\/api\/chat\/conversations$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "conversations-cache",
              expiration: { maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
    visualizer({ filename: "stats.html", gzipSize: true }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://backend:3000",
        changeOrigin: true,
      },
    },
  },
});
