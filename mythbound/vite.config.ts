import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works at any sub-path or straight from disk.
  base: './',
  // three.js alone is ~600 kB; one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
});
