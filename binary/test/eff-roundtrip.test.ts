import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { effParser } from "../src/eff";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOT = path.join(REPO_ROOT, "external/infinity-engine");

function findEffFixtures(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".eff")) {
                out.push(full);
            }
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

describe("effParser - round-trip on real EFF v2 fixtures", () => {
    const fixtures = findEffFixtures(EXTERNAL_ROOT);
    if (fixtures.length === 0) {
        test.skip("no EFF fixtures present", () => {});
    } else {
        test.each(fixtures)("parse -> serialize is byte-identical for %s", (fixturePath) => {
            const bytes = new Uint8Array(fs.readFileSync(fixturePath));
            const result = effParser.parse(bytes);
            if (result.errors) throw new Error(result.errors.join(", "));

            const reserialized = effParser.serialize!(result);
            expect(reserialized.byteLength).toBe(bytes.byteLength);
            expect([...reserialized]).toEqual([...bytes]);
        });

        test("first fixture has no opaqueRanges", () => {
            const bytes = new Uint8Array(fs.readFileSync(fixtures[0]!));
            const result = effParser.parse(bytes);
            expect(result.opaqueRanges).toBeUndefined();
            expect(result.document).toBeDefined();
        });
    }
});
