/**
 * Vitest configuration for integration tests using real external fixture files.
 *
 * Separated from the main config because these tests require external repos
 * to be cloned (via scripts/test-external.sh or pnpm test:external).
 * Run with: cd server && pnpm test:integration
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step (mirrors vitest.config.ts).
        alias: {
            "@bgforge/format": path.resolve(__dirname, "../format/src/index.ts"),
        },
    },
    test: {
        name: "server-integration",
        include: ["test/integration/**/*.test.ts"],
        setupFiles: ["test/integration/setup.ts"],
    },
});
