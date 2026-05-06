import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { splParser } from "../src/spl";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WILDMAGE_ROOT = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage");

function findSplFixtures(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".spl")) {
                out.push(full);
            }
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

describe("splParser — round-trip on real SPL v1 fixtures", () => {
    const fixtures = findSplFixtures(WILDMAGE_ROOT);
    if (fixtures.length === 0) {
        test.skip("no wildmage SPL fixtures present", () => {});
    } else {
        test.each(fixtures)("parse → serialize is byte-identical for %s", (fixturePath) => {
            const bytes = new Uint8Array(fs.readFileSync(fixturePath));
            const result = splParser.parse(bytes);
            if (result.errors) throw new Error(result.errors.join(", "));

            const reserialized = splParser.serialize!(result);
            expect(reserialized.byteLength).toBe(bytes.byteLength);
            expect([...reserialized]).toEqual([...bytes]);
        });

        test("first fixture has no opaqueRanges", () => {
            const bytes = new Uint8Array(fs.readFileSync(fixtures[0]!));
            const result = splParser.parse(bytes);
            expect(result.opaqueRanges).toBeUndefined();
            expect(result.document).toBeDefined();
        });
    }
});
