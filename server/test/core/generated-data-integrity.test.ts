/**
 * Integrity guard for the committed generated static-data JSON in server/out/.
 *
 * These files (completion.*, signature.*) are produced by
 * scripts/generate-data.sh from server/data/*.yml and committed to the repo, then
 * loaded verbatim at runtime by core/static-loader.ts. The rest of static-loader's
 * tests mock fs and so never touch the real artifacts; a malformed committed file
 * (e.g. a repo-wide text/Unicode sweep turning curly quotes inside a JSON string
 * value into unescaped ASCII quotes) parses to zero symbols at runtime while every
 * mocked test stays green. This test reads the real files so that class of
 * corruption fails the suite instead of silently shipping an empty provider.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OUT_DIR = path.join(__dirname, "../../out");
const GENERATED_RE = /^(?:completion|signature)\.[\w.-]+\.json$/;

const generatedFiles = readdirSync(OUT_DIR).filter((name) => GENERATED_RE.test(name));

describe("generated static-data integrity", () => {
    // Guard the guard: if the glob matches nothing (out/ missing or renamed), an
    // empty it.each would pass silently and hide the regression we are protecting against.
    it("discovers the committed generated JSON files", () => {
        expect(generatedFiles.length).toBeGreaterThan(0);
    });

    it.each(generatedFiles)("%s is valid, non-empty JSON", (name) => {
        const raw = readFileSync(path.join(OUT_DIR, name), "utf8");
        const data: unknown = JSON.parse(raw); // throws -> fails the test on malformed JSON
        const size = Array.isArray(data) ? data.length : Object.keys(data as object).length;
        expect(size).toBeGreaterThan(0);
    });
});
