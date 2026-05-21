import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'prompt',
      devOptions: { enabled: true },
      manifest: {
        name: 'Birdnest Room Display',
        short_name: 'Room Display',
        description: 'In-room kiosk display for Birdnest Glamping guests',
        theme_color: '#05070a',
        background_color: '#05070a',
        display: 'fullscreen',
        orientation: 'landscape',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/board-images': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
