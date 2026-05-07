/**
 * Vitest configuration for all data update script tests.
 *
 * Coverage is not gated here: `pnpm test:scripts` runs without `--coverage`,
 * and `scripts/test.sh` does not include scripts in its Phase-1.5 sequential
 * coverage block. Add `--coverage` and a thresholds block here if scripts
 * coverage ever needs to gate CI.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "scripts",
        include: ["scripts/*/test/**/*.test.ts"],
        testTimeout: 30_000,
    },
});
