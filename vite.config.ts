/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 900, // three.js alone is ~600 kB
  },
  test: {
    // Only this repo's tests: without an include, Vitest also collects the copies in .claude/worktrees/.
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
  },
});
