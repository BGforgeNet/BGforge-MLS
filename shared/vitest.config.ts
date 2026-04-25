import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        name: "shared",
        include: [path.resolve(__dirname, "**/test/**/*.test.ts")],
    },
});
