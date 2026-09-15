/**
 * Vitest configuration used by Stryker mutation testing.
 *
 * Extends `vitest.config.ts` (the binary unit suite) and turns coverage off - mutation testing does its
 * own coverage analysis (`coverageAnalysis: "perTest"` in `stryker.conf.json`), and v8 instrumentation on
 * top of it is pure cost.
 *
 * The CLI tests are already excluded by the base config (they need the built bundle). `external/` needs no
 * exclusion here the way it does for the server: the fixtures that read it are `skipIf`-gated on the
 * checkout being present, and Stryker's sandbox omits `external/`, so they skip rather than fail. The base
 * config's `globalSetup` is kept for the same reason - it guards on a `.git` directory that the sandbox
 * does not contain, so it is a no-op there rather than a divergence worth maintaining separately.
 */

import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            name: "binary-mutation",
            coverage: { enabled: false },
        },
    }),
);
