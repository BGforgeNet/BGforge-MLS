/**
 * Vitest configuration for cross-package CLI integration tests.
 *
 * These tests spawn each release CLI bundle as a child process to verify exit
 * codes, stdout output, and stderr diff reporting. They live next to their
 * owning packages but share an orchestration entry point so the suite can be
 * gated as a single phase that runs after the CLIs are built.
 *
 * No coverage thresholds: subprocess instrumentation via child_process does
 * not capture v8 in-process coverage. These tests substitute behavioural
 * verification for a numeric coverage gate.
 */

import { defineConfig } from "vitest/config";
import path from "path";

const root = path.resolve(__dirname, "..");

export default defineConfig({
    test: {
        name: "cli-integration",
        include: [
            path.resolve(root, "binary/test/bin-cli.test.ts"),
            path.resolve(root, "format/test/format-cli.test.ts"),
            path.resolve(root, "transpilers/test/transpile-cli.test.ts"),
            path.resolve(root, "test/smoke.test.ts"),
        ],
        testTimeout: 30_000,
    },
});
