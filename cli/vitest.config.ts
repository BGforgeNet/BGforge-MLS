/**
 * Vitest configuration for CLI integration tests.
 *
 * No coverage thresholds: CLI tests spawn the built bundle via child_process
 * (see cli/test/bin-cli.test.ts), so v8 in-process instrumentation does not
 * capture source-line coverage. Enforcing a threshold here requires subprocess
 * coverage plumbing (NODE_V8_COVERAGE env var + merge), which is out of scope
 * for the current gate. Code behaviour is exercised; only the numeric gate is
 * omitted.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "cli",
        include: ["cli/test/**/*.test.ts"],
        testTimeout: 30_000,
    },
});
