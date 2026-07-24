import { defineConfig } from "vitest/config";

// Admin Dashboard unit tests. Scoped to lib/admin so we exercise the founder
// authorization core and canonical query shaping without needing a live Next
// runtime (next/headers etc. are mocked per-test).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/admin/__tests__/**/*.test.ts"],
    globals: true,
  },
});
