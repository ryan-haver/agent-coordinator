import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration config: include ONLY integration tests
    include: ['tests/integration/**/*.test.ts'],
  },
});
