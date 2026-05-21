import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { creParser } from "../src/cre";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOT = path.join(REPO_ROOT, "external/infinity-engine");

function findCreFixtures(root: string): string[] {
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
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".cre")) {
                out.push(full);
            }
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

describe("creParser - round-trip on real CRE v1 fixtures", () => {
    const fixtures = findCreFixtures(EXTERNAL_ROOT);
    if (fixtures.length === 0) {
        test.skip("no CRE fixtures present", () => {});
        return;
    }

    test.each(fixtures)("parse -> serialize is byte-identical for %s", (fixturePath) => {
        const bytes = new Uint8Array(fs.readFileSync(fixturePath));
        const result = creParser.parse(bytes);
        if (result.errors) throw new Error(result.errors.join(", "));

        const reserialized = creParser.serialize!(result);
        expect(reserialized.byteLength).toBe(bytes.byteLength);
        expect([...reserialized]).toEqual([...bytes]);
    });

    test("first fixture has a canonical document and no opaqueRanges", () => {
        const bytes = new Uint8Array(fs.readFileSync(fixtures[0]!));
        const result = creParser.parse(bytes);
        expect(result.errors).toBeUndefined();
        expect(result.opaqueRanges).toBeUndefined();
        expect(result.document).toBeDefined();
    });

    test("covers both EFF v1 and EFF v2 effect-structure variants", () => {
        // Surveyed across external/infinity-engine: BGT-WeiDU/bgt/fixpack
        // contributes EFF v1 fixtures, BGT-WeiDU/bgt/base/cre contributes EFF v2.
        // If either bucket vanishes, the dispatch in cre/index.ts is one branch
        // un-covered.
        let sawV1 = false;
        let sawV2 = false;
        for (const fixture of fixtures) {
            const bytes = new Uint8Array(fs.readFileSync(fixture));
            const result = creParser.parse(bytes);
            const doc = result.document;
            if (!doc || !("effects" in doc) || typeof doc.effects !== "object" || doc.effects === null) continue;
            const kind = (doc.effects as { kind: "v1" | "v2" }).kind;
            if (kind === "v1") sawV1 = true;
            if (kind === "v2") sawV2 = true;
            if (sawV1 && sawV2) break;
        }
        expect(sawV1).toBe(true);
        expect(sawV2).toBe(true);
    });
});
