import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        name: "transpile-lib",
        include: ["transpilers/test/**/*.test.ts"],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from test/vitest.cli.config.ts in a later phase.
        exclude: ["transpilers/test/**/*-cli.test.ts"],
        testTimeout: 30_000,
    },
});
