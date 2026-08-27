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
            "server/vitest.config.mts",
            "server/vitest.integration.config.mts",
            "server/vitest.smoke.config.mts",
            "client/vitest.config.mts",
            "plugins/tssl-plugin/vitest.config.mts",
            "plugins/td-plugin/vitest.config.mts",
            "scripts/vitest.config.ts",
            "shared/vitest.config.ts",
            "transpilers/vitest.config.ts",
            "binary/vitest.config.ts",
            "binary-editor/vitest.config.ts",
            "format/vitest.config.ts",
            "image/vitest.config.ts",
            "compilers/bcs/vitest.config.ts",
            "compilers/ssl/vitest.config.ts",
            "compilers/tssl/vitest.config.ts",
            "scripts/vitest.cli.config.ts",
        ],
    },
});
