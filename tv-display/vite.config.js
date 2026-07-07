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
  plugins: [tailwindcss(), react()],
  server: {
    port: 5176,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      '/board-images': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
});
