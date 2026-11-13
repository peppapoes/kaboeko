import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8080,
  },
  build: {
    // Phaser itself is ~1.3 MB minified, so raise the default 500 kB warning limit.
    chunkSizeWarningLimit: 1500,
  },
});
