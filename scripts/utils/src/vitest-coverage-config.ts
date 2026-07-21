/**
 * Shared vitest `coverage` block for the per-package unit-test configs
 * (server, client, binary, binary-editor, format, shared, transpilers, the
 * two TS plugins). Every one of those configs uses the same provider,
 * reporter set, and `clean: false` workaround, and differs only in
 * thresholds plus (for some packages) `reportsDirectory`/`include`/`exclude`
 * scoping - this factors out the uniform part.
 */

import type { CoverageV8Options } from "vitest/node";

/** Per-package coverage floors; every field is required so a config can't silently omit a metric. */
export interface CoverageThresholds {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
}

interface CoverageConfigOptions {
    thresholds: CoverageThresholds;
    /**
     * Every config must set a distinct directory: two runs sharing one
     * reportsDirectory race on its `.tmp/` shard files when run in parallel.
     */
    reportsDirectory?: string;
    /** Restricts the coverage denominator to the package's own source; omit for the v8 default (files loaded by tests). */
    include?: string[];
    exclude?: string[];
}

export function coverageConfig({
    thresholds,
    reportsDirectory,
    include,
    exclude,
}: CoverageConfigOptions): CoverageV8Options {
    return {
        provider: "v8",
        reporter: ["text", "html", "lcov"],
        ...(reportsDirectory !== undefined ? { reportsDirectory } : {}),
        // Maintainer-recommended workaround for the .tmp/coverage-N.json
        // ENOENT race under parallel coverage runs (vitest-dev/vitest
        // #4943, #5903). scripts/test.sh also serialises coverage jobs.
        clean: false,
        ...(include !== undefined ? { include } : {}),
        ...(exclude !== undefined ? { exclude } : {}),
        thresholds,
    };
}
