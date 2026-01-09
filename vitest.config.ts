import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/main.ts', // Plugin entry point requires Obsidian
        'src/opencode-obsidian-view.ts', // UI component requires Obsidian
        'src/settings.ts', // UI component requires Obsidian
      ],
    },
    // Mock obsidian module for tests
    server: {
      deps: {
        external: ['obsidian'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['obsidian'],
  },
})
