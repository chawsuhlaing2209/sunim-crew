import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Tests never read the machine's environment. Config is always injected.
    clearMocks: true,
  },
});
