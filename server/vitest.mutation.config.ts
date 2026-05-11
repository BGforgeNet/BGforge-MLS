/**
 * Vitest configuration used by Stryker mutation testing.
 *
 * Extends `vitest.config.ts` (server unit suite) and excludes the few tests
 * that read fixtures from `external/`. Stryker's sandbox excludes `external/`
 * because it contains cloned mod repos with broken symlinks that crash the
 * sandbox copy; the affected tests cannot run inside the sandbox regardless.
 *
 * Coverage is disabled here - mutation testing has its own coverage analysis
 * (`coverageAnalysis: "perTest"` in `stryker.conf.json`).
 */

import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            name: "server-mutation",
            exclude: [
                "test/smoke-stdio.test.ts",
                "test/integration/**",
                "test/perf/**",
                "test/fallout-ssl/rename.test.ts",
                "test/fallout-ssl/call-sites.test.ts",
                "test/weidu-tp2/format.test.ts",
            ],
            coverage: { enabled: false },
        },
    }),
);
