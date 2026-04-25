import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "binary-lib",
        // Use an absolute include path so the config works both when run from the
        // package directory (pnpm test) and from the repo root (scripts/test.sh).
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from test/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(__dirname, "test/**/*-cli.test.ts")],
        // v8 coverage instrumentation slows the binary parser tests; the 5s
        // vitest default is too tight for them.
        testTimeout: 15_000,
    },
});
