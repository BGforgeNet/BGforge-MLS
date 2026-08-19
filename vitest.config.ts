/**
 * Vitest root configuration aggregating all test projects via `test.projects`.
 * Named `vitest.config.ts` (not `vitest.workspace.ts`): Vitest 4 discovery no
 * longer auto-loads the workspace filename, so `vitest run` / `vitest run
 * --project <name>` at the repo root only pick this up under the config name.
 *
 * This file is additive - it does not replace the per-package `test.sh`
 * orchestration used by `pnpm test` and `pnpm test:all`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            "server/vitest.config.ts",
            "server/vitest.integration.config.ts",
            "server/vitest.smoke.config.ts",
            "client/vitest.config.ts",
            "plugins/tssl-plugin/vitest.config.ts",
            "plugins/td-plugin/vitest.config.ts",
            "scripts/vitest.config.ts",
            "shared/vitest.config.ts",
            "transpilers/vitest.config.ts",
            "binary/vitest.config.ts",
            "binary-editor/vitest.config.ts",
            "format/vitest.config.ts",
            "image/vitest.config.ts",
            "compilers/ssl/vitest.config.ts",
            "scripts/vitest.cli.config.ts",
        ],
    },
});
