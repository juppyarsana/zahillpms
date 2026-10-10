import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
    tailwindcss(),
    react(),
    // dist/version.json — which build is on the server. A TV that has been on
    // for days asks for it and loads the page again when it changed (App.jsx).
    {
      name: 'build-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit: commitHash }) });
      },
    },
  ],
  server: {
    port: 5176,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/board-images': { target: 'http://localhost:4000', changeOrigin: true },
      '/property-logos': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
