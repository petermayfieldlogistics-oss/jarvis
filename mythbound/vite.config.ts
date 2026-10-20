import { defineConfig } from 'vitest/config';
import { packModels } from './scripts/pack-models.mjs';

export default defineConfig({
  // Relative base so the build works at any sub-path or straight from disk.
  base: './',
  // three.js alone is ~600 kB; one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 2000 },
  // The Blender model files go out packed, about a third smaller (see scripts/pack-models.mjs).
  plugins: [packModels()],
  test: { environment: 'node' },
});
