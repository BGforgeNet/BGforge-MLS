import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register all parsers and adapters
import { creParser } from "../src/cre";
import { createCanonicalCreJsonSnapshot, loadCanonicalCreJsonSnapshot } from "../src/cre/json-snapshot";
import { formatAdapterRegistry } from "../src/format-adapter";

const creFormatAdapter = formatAdapterRegistry.get("cre")!;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Fixture choice mirrors itm-spl-snapshot.test.ts: pin one real file per
// dispatch branch under external/infinity-engine/. bpimoen.cre exercises the
// EFF v2 effect-record path (header byte 0x33 == 1, 0x108-byte records);
// iron15.cre exercises EFF v1 (0x30-byte records) which only BGT-WeiDU's
// fixpack subdirectory ships.
const CRE_V2_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/base/cre/bpimoen.cre");
const CRE_V1_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/fixpack/iron15.cre");
const hasFixture = fs.existsSync(CRE_V2_FIXTURE) && fs.existsSync(CRE_V1_FIXTURE);

describe.skipIf(!hasFixture)("CRE canonical snapshot round-trip", () => {
    test("createCanonical -> loadCanonical produces byte-identical output (EFF v2)", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V2_FIXTURE));
        const result = creParser.parse(bytes);
        const json = createCanonicalCreJsonSnapshot(result);
        const loaded = loadCanonicalCreJsonSnapshot(json);
        expect([...loaded.bytes]).toEqual([...bytes]);
        expect(loaded.snapshot.format).toBe("cre");
    });

    test("createCanonical -> loadCanonical produces byte-identical output (EFF v1)", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V1_FIXTURE));
        const result = creParser.parse(bytes);
        const json = createCanonicalCreJsonSnapshot(result);
        const loaded = loadCanonicalCreJsonSnapshot(json);
        expect([...loaded.bytes]).toEqual([...bytes]);
        expect(loaded.snapshot.format).toBe("cre");
    });

    test("creFormatAdapter routes the snapshot through createJsonSnapshot/loadJsonSnapshot", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V2_FIXTURE));
        const result = creParser.parse(bytes);
        const json = creFormatAdapter.createJsonSnapshot(result);
        const loaded = creFormatAdapter.loadJsonSnapshot(json);
        expect(loaded.bytes).toBeDefined();
        expect([...loaded.bytes!]).toEqual([...bytes]);
    });

    test("rebuildCanonicalDocument echoes the parser's canonical document", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V2_FIXTURE));
        const result = creParser.parse(bytes);
        const doc = creFormatAdapter.rebuildCanonicalDocument(result);
        expect(doc).toBeDefined();
        // rebuildDocument returns the document from result.document when present.
        expect(doc).toMatchObject(result.document as object);
    });

    test("snapshot JSON shape: effects is a discriminated union with kind + records", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V2_FIXTURE));
        const result = creParser.parse(bytes);
        const json = createCanonicalCreJsonSnapshot(result);
        const parsed = JSON.parse(json);
        expect(parsed.document.effects).toMatchObject({ kind: "v2" });
        expect(Array.isArray(parsed.document.effects.records)).toBe(true);
        expect(parsed.document.itemSlots).toHaveLength(40);
    });

    test("snapshot JSON shape: v1 effects carry the v1 kind tag", () => {
        const bytes = new Uint8Array(fs.readFileSync(CRE_V1_FIXTURE));
        const result = creParser.parse(bytes);
        const json = createCanonicalCreJsonSnapshot(result);
        const parsed = JSON.parse(json);
        expect(parsed.document.effects.kind).toBe("v1");
    });

    test.each<[readonly string[], string | undefined]>([
        [["CRE Header", "Creature Flags"], "cre.header.creatureFlags"],
        [["Known Spells", "Known Spell 1", "Spell"], "cre.knownSpells[].spell"],
        [["Spell Memorization Info", "Entry 1", "Spell Level"], "cre.spellMemInfo[].spellLevel"],
        [["Memorized Spells", "Memorized Spell 1", "Spell"], "cre.memorizedSpells[].spell"],
        [["Effects", "Effect 1", "Opcode"], "cre.effects[].v2.opcode"],
        [["Items", "Item 1", "Item"], "cre.items[].item"],
        [["Item Slots", "Helmet"], "cre.itemSlots.helmet"],
        [["Item Slots", "Selected weapon"], "cre.itemSlots.selectedWeapon"],
        [["Item Slots"], "cre.itemSlots"],
        [[], undefined],
    ])("creFormatAdapter.toSemanticFieldKey %j -> %j", (segments, expected) => {
        expect(creFormatAdapter.toSemanticFieldKey(segments)).toBe(expected);
    });
});
