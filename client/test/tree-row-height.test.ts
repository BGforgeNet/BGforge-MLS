/**
 * Guard: the outline's virtual window is pure arithmetic on `ROW_H`, so that constant and the height every
 * row kind is pinned to in the component's CSS are ONE value expressed twice.
 *
 * Nothing else catches drift between them. If the CSS height changes alone, rows silently stop landing in
 * their computed slots - every row sits progressively further from where the window thinks it is, and no
 * test, typecheck or lint says a word. Only a live render shows it, and only if someone looks.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./repo-root";

const SOURCE = path.join(REPO_ROOT, "client/src/dialog-editor/webview/Tree.svelte");

describe("dialog outline row height", () => {
    it("declares the same row height in the script constant and the CSS", () => {
        const src = fs.readFileSync(SOURCE, "utf8");

        const constMatch = /const ROW_H = (\d+);/.exec(src);
        expect(constMatch, "ROW_H constant not found in Tree.svelte").not.toBeNull();

        // The shared rule that pins every row kind to one height; the window's arithmetic assumes it.
        const cssMatch = /\.st,\s*\.rep,\s*\.brep,\s*\.saycont,\s*\.addopt \{[^}]*?height: (\d+)px;/.exec(src);
        expect(cssMatch, "shared row-height CSS rule not found in Tree.svelte").not.toBeNull();

        expect(Number(cssMatch![1])).toBe(Number(constMatch![1]));
    });
});
