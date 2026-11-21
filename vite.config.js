import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 1800000,
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
