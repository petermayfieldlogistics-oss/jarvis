import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the same build works at a GitHub Pages sub-path
  // (https://<user>.github.io/<repo>/) or at a domain root.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
