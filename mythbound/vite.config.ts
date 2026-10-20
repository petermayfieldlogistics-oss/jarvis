import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

export default defineConfig({
  // Relative base so the build works at any sub-path or straight from disk.
  base: './',
  // three.js alone is ~600 kB; one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [gzipModels()],
  test: { environment: 'node' },
});

/**
 * Ships the Blender .glb models gzipped, about half the download (the other
 * model files are stored gzipped already); assets.ts unpacks them.
 */
function gzipModels(): Plugin {
  return {
    name: 'mythbound-gzip-glb',
    apply: 'build',
    async generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.glb')) continue;
        const data = typeof f.source === 'string' ? new TextEncoder().encode(f.source) : new Uint8Array(f.source);
        const packed = new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip')));
        f.source = new Uint8Array(await packed.arrayBuffer());
      }
    },
  };
}
