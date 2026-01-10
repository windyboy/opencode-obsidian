import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
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
        inline: ['obsidian'], // Inline obsidian for better test support
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'obsidian': path.resolve(__dirname, './__mocks__/obsidian.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['obsidian'],
  },
})
