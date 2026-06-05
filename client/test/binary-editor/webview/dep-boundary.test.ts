import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Absolute path to the webview source directory so cwd doesn't matter.
const webviewDir = path.resolve(__dirname, "../../../src/binary-editor/webview");

describe("bits-ui dependency boundary", () => {
    it("is imported only under components/primitives/", () => {
        const raw = execSync(`rg -l --color=never "bits-ui" "${webviewDir}" || true`, { encoding: "utf8" })
            .trim()
            .split("\n")
            .filter(Boolean);
        const outside = raw.filter((f) => !f.includes("/components/primitives/"));
        expect(outside).toEqual([]);
    });
});
