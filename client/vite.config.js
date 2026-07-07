import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';

const commitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
})();

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(commitHash),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'logo.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Zahill PMS',
        short_name: 'Zahill',
        description: 'Glamping Property Management System — Kintamani, Bali',
        theme_color: '#5C1A2E',
        background_color: '#5C1A2E',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        id: '/',
        prefer_related_applications: false,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4001', changeOrigin: true },
      '/board-images': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
});
