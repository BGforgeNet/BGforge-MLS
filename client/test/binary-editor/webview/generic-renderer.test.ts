import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSourceFiles } from "./source-scan";

// Absolute path to the webview source directory so cwd does not matter.
const webviewSrc = path.resolve(__dirname, "../../../src/binary-editor/webview");
const componentsDir = path.join(webviewSrc, "components");
const stateDir = path.join(webviewSrc, "state");

describe("generic webview (no format-specific code)", () => {
    it("contains no format-id branching in components or state", () => {
        // The webview must render from the layout descriptor + field kinds, never branch on a concrete format.
        //
        // Pattern design rationale:
        //   - ["'](itm|...)["']  catches quoted format-id string literals (the most direct form of
        //     branching: === "itm", case "itm", includes("spl"), etc.).
        //   - (languageId|format|formatId|fmt) ?===  catches equality tests on a format/language
        //     discriminator variable, regardless of what the RHS is.
        //   - case ["'](itm|...)["']  catches switch arms keyed on format identity (belt-and-suspenders
        //     alongside the quoted-literal pattern, catches multi-line switch layouts).
        //
        // False-positive audit (2026-06-05): the naive \.(itm|...|map)\b pattern hits
        // JavaScript .map() array method calls. The quoted-literal form avoids that: .map() never
        // appears as a quoted string. The languageId/format === pattern avoids .map() entirely.
        // Comments mentioning "ITM", "itm/spl", "render-itm/spl harness" do appear in the source
        // as documentation, but matching is case-sensitive and those are prose, not string
        // literals or equality tests, so they are not captured by any of the patterns below.
        // The patterns are deliberately case-sensitive so "map" in .map() and "Map" in "new Map()"
        // do not collide with the quoted "map" format id check.
        const patterns = [
            /["'](itm|spl|eff|cre|pro|map)["']/, // quoted format-id string literal
            /(languageId|format|formatId|fmt) ?===/, // equality on a format discriminator variable
            /case ["'](itm|spl|eff|cre|pro|map)["']/, // switch arm keyed on format identity
        ];

        // Read files in-process rather than via `rg` so the test does not depend on a tool absent in CI.
        const hits: string[] = [];
        for (const file of [...listSourceFiles(componentsDir), ...listSourceFiles(stateDir)]) {
            fs.readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, i) => {
                    if (patterns.some((re) => re.test(line))) hits.push(`${file}:${i + 1}:${line}`);
                });
        }

        expect(hits, `format-specific code found in webview:\n${hits.join("\n")}`).toEqual([]);
    });
});
