import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "../binary/src/index.ts"),
        },
    },
    test: {
        name: "binary-editor",
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        testTimeout: 15000,
    },
});
