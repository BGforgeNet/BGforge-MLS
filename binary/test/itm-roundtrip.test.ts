import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { itmParser } from "../src/itm";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WILDMAGE_ROOT = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage");
const FIRST_FIXTURE = path.join(WILDMAGE_ROOT, "wildmage/wild_spells/itm/wm_sbook.itm");

function findItmFixtures(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".itm")) {
                out.push(full);
            }
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

describe("itmParser — round-trip on real ITM v1 fixtures", () => {
    test("decoded header has the V1 signature", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIRST_FIXTURE));
        const result = itmParser.parse(bytes);
        const header = result.root.fields[0];
        expect(header).toBeDefined();
        expect("name" in header! && header.name).toBe("ITM Header");
    });

    test("canonical document has no opaqueRanges (full byte-level decode)", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIRST_FIXTURE));
        const result = itmParser.parse(bytes);
        expect(result.opaqueRanges).toBeUndefined();
        expect(result.document).toBeDefined();
    });

    const fixtures = findItmFixtures(WILDMAGE_ROOT);
    if (fixtures.length === 0) {
        test.skip("no wildmage ITM fixtures present", () => {});
    } else {
        test.each(fixtures)("parse → serialize is byte-identical for %s", (fixturePath) => {
            const bytes = new Uint8Array(fs.readFileSync(fixturePath));
            const result = itmParser.parse(bytes);
            if (result.errors) throw new Error(result.errors.join(", "));

            const reserialized = itmParser.serialize!(result);
            expect(reserialized.byteLength).toBe(bytes.byteLength);
            expect([...reserialized]).toEqual([...bytes]);
        });
    }

    test("serializer recomputes derived structural fields, ignoring corrupted input", async () => {
        // A canonical doc whose header pointers have been hand-edited to bogus
        // values must still produce a valid file: enforceDerivedFields recomputes
        // the fields the writer can definitively supply (header size for the
        // abilities offset, abilities.length for the count, abilities-end for
        // the effects offset). featureBlocksIndex/Count are equipping-subset
        // metadata the helper has no truth source for and are preserved as-is.
        const { serializeItmCanonicalDocument } = await import("../src/itm/canonical-writer");
        const { getItmCanonicalDocument } = await import("../src/itm/canonical-reader");
        const bytes = new Uint8Array(fs.readFileSync(FIRST_FIXTURE));
        const result = itmParser.parse(bytes);
        const doc = getItmCanonicalDocument(result);
        if (!doc) throw new Error("no canonical doc");

        const corrupted = {
            ...doc,
            header: {
                ...doc.header,
                extendedHeadersOffset: 99999,
                extendedHeadersCount: 99,
                featureBlocksOffset: 99999,
            },
        };
        const reserialized = serializeItmCanonicalDocument(corrupted);
        expect([...reserialized]).toEqual([...bytes]);
    });
});
