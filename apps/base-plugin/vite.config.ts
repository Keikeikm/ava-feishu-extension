import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.AVA_PREVIEW_PORT ?? 5173),
    strictPort: true,
    // Keep the preview Host header so Express recognizes browser POSTs as same-origin.
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}`, changeOrigin: false },
    },
  },
});
