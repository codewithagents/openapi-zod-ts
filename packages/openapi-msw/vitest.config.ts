import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/cli.ts', 'src/generator.ts'],
      // Ratcheted below current (stmts/branches/funcs/lines 89.27/82.6/97.95/93.45) with
      // margin (smaller, more volatile suite). Ratchet up over time.
      thresholds: {
        branches: 76,
        functions: 92,
        lines: 88,
        statements: 84,
      },
      reporter: ['text', ['lcov', { projectRoot: '../../' }]],
    },
  },
})
