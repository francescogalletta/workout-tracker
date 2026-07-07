/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Deploy base is configurable so the same build serves from a user site (`/`)
// or a project page (`/workout-tracker/`). vite-plugin-pwa derives the
// manifest scope/start_url and the service worker's navigateFallback from this.
const base = process.env.BASE_PATH ?? '/'

// The PWA plugin is skipped under Vitest: the service worker is a build-time
// artifact with nothing to assert in the node test env, and leaving it out
// keeps the suite fast and free of Workbox side effects.
const isTest = process.env.VITEST === 'true'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    ...(isTest
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            // Precache extra public assets not referenced in the build graph.
            includeAssets: ['icons/icon-180.png', 'icons/icon-1024.png'],
            // No service worker in dev — keeps `npm run dev` free of caching.
            devOptions: { enabled: false },
            workbox: {
              globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,json,ico}'],
              // Hash router: any navigation falls back to the app shell.
              navigateFallback: 'index.html',
              cleanupOutdatedCaches: true,
            },
            manifest: {
              name: 'Lift',
              short_name: 'Lift',
              description: 'Offline-first workout tracker',
              display: 'standalone',
              orientation: 'portrait',
              theme_color: '#000000',
              background_color: '#000000',
              icons: [
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: 'icons/icon-512-maskable.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
                { src: 'icons/icon-1024.png', sizes: '1024x1024', type: 'image/png' },
                { src: 'icons/icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
              ],
            },
          }),
        ]),
  ],
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
