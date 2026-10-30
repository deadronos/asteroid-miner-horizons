/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    // three.js is ~600 kB, so the vendor chunk sits above Vite's 500 kB default.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // three in its own chunk keeps it cached across game updates.
        advancedChunks: { groups: [{ name: 'vendor', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  test: {
    // Only this repo's tests: without an include, Vitest also collects the copies in .claude/worktrees/.
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
  },
});
