/**
 * Vitest configuration for all data update script tests.
 *
 * Coverage is not gated here: `pnpm test:scripts` runs without `--coverage`,
 * and `scripts/test.sh` does not include scripts in its Phase-1.5 sequential
 * coverage block. Add `--coverage` and a thresholds block here if scripts
 * coverage ever needs to gate CI.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        name: "scripts",
        // Absolute so discovery works both from scripts/ and from the repo root
        // (pnpm test:scripts invokes this config from root).
        include: [path.resolve(__dirname, "*/test/**/*.test.ts")],
        // Spawns the built CLI bundles, which Phase 2 produces after this phase runs. Re-included by
        // scripts/vitest.cli.config.ts, the same split the per-package configs use for their own
        // `*-cli.test.ts`.
        exclude: [path.resolve(__dirname, "utils/test/cli-help.test.ts")],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically on a 4-vCPU runner; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
    },
});
