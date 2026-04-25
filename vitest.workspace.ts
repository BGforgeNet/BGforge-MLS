/**
 * Vitest root configuration enabling workspace mode via `test.projects`.
 * Allows `vitest run` at the repo root to discover all test projects,
 * and `vitest run --project <name>` to target a specific one.
 *
 * This file is additive — it does not replace the per-package `test.sh`
 * orchestration used by `pnpm test` and `pnpm test:all`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            "server/vitest.config.ts",
            "server/vitest.integration.config.ts",
            "server/vitest.smoke.config.ts",
            "cli/vitest.config.ts",
            "client/vitest.config.ts",
            "plugins/tssl-plugin/vitest.config.ts",
            "plugins/td-plugin/vitest.config.ts",
            "scripts/vitest.config.ts",
            "transpilers/vitest.config.ts",
        ],
    },
});
