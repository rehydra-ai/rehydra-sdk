import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/ner/**'],
    },
    benchmark: {
      include: ['test/benchmark/**/*.bench.ts'],
      outputJson: './benchmarks/latest.json',
    },
  },
});

