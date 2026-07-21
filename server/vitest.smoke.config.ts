/**
 * Vitest configuration for the server smoke test.
 * Separated from the main config because it requires a built server bundle.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        name: "server-smoke",
        // Absolute so discovery works both from server/ and from the repo root.
        include: [path.resolve(__dirname, "test/smoke-stdio.test.ts")],
    },
});
