import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use a relative base so the app works under GitHub Pages project subpaths.
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: [
      '@react-pdf/renderer',
      '@blocknote/xl-pdf-exporter',
      'base64-js',
      'unicode-properties',
    ],
  },
});
