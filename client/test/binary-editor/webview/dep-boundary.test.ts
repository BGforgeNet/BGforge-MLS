import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Absolute path to the webview source directory so cwd doesn't matter.
const webviewDir = path.resolve(__dirname, "../../../src/binary-editor/webview");

describe("bits-ui dependency boundary", () => {
    it("is imported only under components/primitives/", () => {
        // Match actual imports only (static `from "bits-ui"` / dynamic `require("bits-ui")`) so a code comment
        // mentioning the library outside primitives/ does not false-positive. The oxlint no-restricted-imports
        // rule is the precise import guard; this rg backstop just mirrors that real constraint. execFileSync
        // (no shell) avoids quoting issues from the quote chars inside the pattern; rg exits 1 on no matches,
        // which we treat as the empty (compliant) result.
        const pattern = String.raw`from ["']bits-ui["']|require\(["']bits-ui["']\)`;
        let out = "";
        try {
            out = execFileSync("rg", ["-l", "--color=never", pattern, webviewDir], { encoding: "utf8" });
        } catch (error) {
            // rg exit 1 = no matches; anything else (exit >=2) is a real rg failure worth surfacing.
            if ((error as { status?: number }).status !== 1) throw error;
        }
        const raw = out.trim().split("\n").filter(Boolean);
        const outside = raw.filter((f) => !f.includes("/components/primitives/"));
        expect(outside).toEqual([]);
    });
});
