import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Web unit tests:
//   • lib/admin/__tests__  — the founder authorization core + canonical query
//     shaping for the Admin Dashboard
//   • lib/__tests__        — student-web guards that must hold for the ordinary
//     app (platform-admin containment, public-surface assertions)
// Both run without a live Next runtime (next/headers etc. are mocked per-test).
export default defineConfig({
  resolve: {
    alias: {
      // @weglue/shared is consumed as TypeScript source in this monorepo; map
      // the subpath export the guards import so vitest resolves it the same way
      // Next's transpilePackages does.
      "@weglue/shared/auth/platformAdmin": fileURLToPath(
        new URL("../../packages/shared/src/auth/platformAdmin.ts", import.meta.url)
      ),
      "@weglue/shared/avatarCatalog": fileURLToPath(
        new URL("../../packages/shared/src/avatarCatalog.ts", import.meta.url)
      ),
      "@weglue/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["lib/admin/__tests__/**/*.test.ts", "lib/__tests__/**/*.test.ts"],
    globals: true,
  },
});
