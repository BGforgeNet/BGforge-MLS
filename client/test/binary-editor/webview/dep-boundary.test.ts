import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSourceFiles } from "./source-scan";

// Absolute path to the webview source directory so cwd doesn't matter.
const webviewDir = path.resolve(__dirname, "../../../src/binary-editor/webview");

describe("bits-ui dependency boundary", () => {
    it("is imported only under components/primitives/", () => {
        // Match actual imports only (static `from "bits-ui"` / dynamic `require("bits-ui")`) so a code comment
        // mentioning the library outside primitives/ does not false-positive. The oxlint no-restricted-imports
        // rule is the precise import guard; this scan just mirrors that real constraint. Files are read
        // in-process rather than via `rg` so the test does not depend on a tool that is absent in CI.
        const importRe = /from ["']bits-ui["']|require\(["']bits-ui["']\)/;
        const primitivesSeg = `${path.sep}components${path.sep}primitives${path.sep}`;
        const outside = listSourceFiles(webviewDir).filter(
            (f) => importRe.test(fs.readFileSync(f, "utf8")) && !f.includes(primitivesSeg),
        );
        expect(outside).toEqual([]);
    });
});
