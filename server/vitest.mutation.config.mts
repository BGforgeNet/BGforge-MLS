/**
 * Vitest configuration used by Stryker mutation testing.
 *
 * Extends `vitest.config.mts` (server unit suite) and excludes the few tests
 * that read fixtures from `external/`. Stryker's sandbox excludes `external/`
 * because it contains cloned mod repos with broken symlinks that crash the
 * sandbox copy; the affected tests cannot run inside the sandbox regardless.
 *
 * Coverage is disabled here - mutation testing has its own coverage analysis
 * (`coverageAnalysis: "perTest"` in `stryker.conf.json`).
 */

import { defineConfig, mergeConfig } from "vitest/config";
import path from "path";
import baseConfig from "./vitest.config.mts";

export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            name: "server-mutation",
            exclude: [
                path.resolve(import.meta.dirname, "test/smoke-stdio.test.ts"),
                path.resolve(import.meta.dirname, "test/integration/**"),
                path.resolve(import.meta.dirname, "test/perf/**"),
                path.resolve(import.meta.dirname, "test/fallout-ssl/rename.test.ts"),
                path.resolve(import.meta.dirname, "test/fallout-ssl/call-sites.test.ts"),
                path.resolve(import.meta.dirname, "test/weidu-tp2/format.test.ts"),
            ],
            coverage: { enabled: false },
        },
    }),
);
