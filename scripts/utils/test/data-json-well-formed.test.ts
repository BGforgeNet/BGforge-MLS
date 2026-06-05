/**
 * Well-formedness guard for committed data JSON that oxfmt does NOT validate.
 *
 * oxfmt parses every JSON it formats, so malformed non-excluded JSON already
 * fails the format gate. But two data-JSON groups are excluded from oxfmt and so
 * bypass that check: server/out/*.json and syntaxes/*.tmLanguage.json. Both are
 * strict JSON (machine-emitted via JSON.stringify) and both are committed, so a
 * post-generation corruption - the class that silently broke the WeiDU TP2
 * provider (an unescaped quote inside a string value) - would otherwise ship
 * undetected. This parses each so that corruption fails the suite.
 *
 * Scope is strict JSON only (JSON.parse, matching the runtime consumer). The
 * JSONC assets are covered elsewhere: snippets/ and language-configurations/ are
 * not oxfmt-excluded, so oxfmt validates them; themes/*.json are JSONC *and*
 * oxfmt-excluded, so they are not guarded here (a faithful check would need a
 * JSONC parser). server/out is also asserted non-empty by
 * server/test/core/generated-data-integrity.test.ts; the overlap here is the
 * cheap parse check that makes this the single cross-cutting well-formedness gate.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const files = execSync("git ls-files -- 'server/out/*.json' 'syntaxes/*.tmLanguage.json'", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

describe("oxfmt-excluded data JSON is well-formed", () => {
    it("discovers the excluded strict-JSON files", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)("%s parses as strict JSON", (file) => {
        expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    });
});
