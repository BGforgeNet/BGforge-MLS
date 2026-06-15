import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the upper edge of the binary-editor dependency direction: the Svelte render layer must reach
// the parser only THROUGH @bgforge/binary-editor (the layout/session seam), never import @bgforge/binary
// directly. Keeping that one seam means the editor layer is the single place binary's layout-schema types
// cross into the view; a direct webview->binary import would bypass it and re-couple rendering to the codec.
// True today; nothing structural enforced it before this test.
const WEBVIEW = path.resolve(__dirname, "../../src/binary-editor/webview");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return sourceFiles(p);
        return e.name.endsWith(".ts") || e.name.endsWith(".svelte") ? [p] : [];
    });
}

// Matches an `@bgforge/binary` (or subpath) module specifier, but NOT `@bgforge/binary-editor`: the
// lookahead requires the next char to start/continue the specifier (`"`, `'`, `/`), which `-editor` fails.
const BINARY_IMPORT = /["']@bgforge\/binary(?=["'/])/;

describe("webview package boundary", () => {
    it("no webview source imports @bgforge/binary directly (goes through the editor seam)", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(WEBVIEW)) {
            const text = fs.readFileSync(file, "utf8");
            if (BINARY_IMPORT.test(text)) {
                offenders.push(path.relative(WEBVIEW, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
