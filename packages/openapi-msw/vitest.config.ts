import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/cli.ts', 'src/generator.ts'],
      // Seeded below current (82.98/75/96.96/87.97) with generous margin (smaller,
      // more volatile suite). Ratchet up over time.
      thresholds: {
        branches: 70,
        functions: 90,
        lines: 83,
        statements: 78,
      },
      reporter: ['text', ['lcov', { projectRoot: '../../' }]],
    },
  },
})
