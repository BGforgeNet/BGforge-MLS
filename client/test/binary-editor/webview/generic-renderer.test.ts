import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
        // as documentation, but rg's default mode is case-sensitive and those are prose, not string
        // literals or equality tests, so they are not captured by any of the patterns below.
        // The -i flag is intentionally NOT used here so "map" in .map() and "Map" in "new Map()"
        // do not collide with the quoted "map" format id check.
        const patterns = [
            String.raw`["'](itm|spl|eff|cre|pro|map)["']`, // quoted format-id string literal
            String.raw`(languageId|format|formatId|fmt) ?===`, // equality on a format discriminator variable
            String.raw`case ["'](itm|spl|eff|cre|pro|map)["']`, // switch arm keyed on format identity
        ];

        let out = "";
        try {
            out = execFileSync("rg", ["-n", "--color=never", "-e", patterns.join("|"), componentsDir, stateDir], {
                encoding: "utf8",
            });
        } catch (error) {
            // rg exits 1 when it finds NO matches - that is the expected success case.
            // Any other non-zero exit (e.g., 2 = usage/IO error) is a real failure.
            if ((error as { status?: number }).status === 1) out = "";
            else throw error;
        }

        expect(out, `format-specific code found in webview:\n${out}`).toBe("");
    });
});
