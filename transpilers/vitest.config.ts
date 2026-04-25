import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        name: "transpile-lib",
        include: ["transpilers/test/**/*.test.ts"],
        testTimeout: 30_000,
    },
});
