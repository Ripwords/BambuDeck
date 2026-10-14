import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.ico", "favicon-32.png", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "BambuDeck",
        short_name: "BambuDeck",
        description: "Local printer dashboard",
        theme_color: "#f6f7f4",
        background_color: "#f6f7f4",
        display: "standalone",
        start_url: "/",
        scope: "/",
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
            src: "/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        navigateFallbackDenylist: [/^\/api\//, /^\/camera/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
});
