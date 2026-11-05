import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each test file boots its own in-memory PostgreSQL + PostGIS, which takes a few seconds.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
