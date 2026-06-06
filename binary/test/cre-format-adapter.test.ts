import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry } from "../src/format-adapter";
import { creParser } from "../src/cre";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../src/cre/canonical-writer";
import { defaultCreItem, defaultCreKnownSpell } from "../src/cre/entity-ops";
import { CRE_GROUP_LABELS } from "../src/cre/types";
import { computeCreSectionOffsets, type CreCanonicalDocument } from "../src/cre/canonical-schemas";
import type { ParseResult } from "../src/types";

const cre = formatAdapterRegistry.get("cre")!;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOT = path.join(REPO_ROOT, "external/infinity-engine");

function firstFixture(): string | undefined {
    const out: string[] = [];
    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.toLowerCase().endsWith(".cre")) out.push(full);
        }
    }
    walk(EXTERNAL_ROOT);
    return out.sort()[0];
}

const fixture = firstFixture();

function baseWithLists(): ParseResult {
    const r = creParser.parse(new Uint8Array(fs.readFileSync(fixture!)));
    const doc = getCreCanonicalDocument(r) ?? rebuildCreCanonicalDocument(r);
    if (!doc) throw new Error("no doc");
    const withLists: CreCanonicalDocument = {
        ...doc,
        knownSpells: [{ ...defaultCreKnownSpell(), spell: "K1" }],
        items: [{ ...defaultCreItem(), item: "I1" }],
    };
    const offsets = computeCreSectionOffsets(withLists);
    const normalized: CreCanonicalDocument = {
        ...withLists,
        header: {
            ...withLists.header,
            knownSpellsOffset: offsets.knownSpells,
            spellMemInfoOffset: offsets.spellMemInfo,
            memorizedSpellsOffset: offsets.memorizedSpells,
            effectsOffset: offsets.effects,
            itemsOffset: offsets.items,
            itemSlotsOffset: offsets.itemSlots,
        },
    };
    const reparsed = creParser.parse(serializeCreCanonicalDocument(normalized));
    if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
    return reparsed;
}

const maybe = fixture ? describe : describe.skip;

maybe("cre adapter structure-op surface", () => {
    it("classifies the five list sections, not itemSlots/header", () => {
        for (const s of [
            CRE_GROUP_LABELS.knownSpells,
            CRE_GROUP_LABELS.spellMemInfo,
            CRE_GROUP_LABELS.memorizedSpells,
            CRE_GROUP_LABELS.effects,
            CRE_GROUP_LABELS.items,
        ]) {
            expect(cre.isListSection!([s])).toBe(true);
            expect(cre.isModifiableArray!([s])).toBe(true);
        }
        expect(cre.isListSection!([CRE_GROUP_LABELS.itemSlots])).toBe(false);
        expect(cre.isListSection!([CRE_GROUP_LABELS.header])).toBe(false);
    });

    it("offers section-add everywhere except memorized spells", () => {
        expect(cre.isAddableArray!([CRE_GROUP_LABELS.knownSpells])).toBe(true);
        expect(cre.isAddableArray!([CRE_GROUP_LABELS.items])).toBe(true);
        expect(cre.isAddableArray!([CRE_GROUP_LABELS.memorizedSpells])).toBe(false);
    });

    it("routes add-known-spell through the registered adapter", () => {
        const base = baseWithLists();
        const bytes = cre.buildAddEntryBytes!(base, [CRE_GROUP_LABELS.knownSpells]);
        expect(bytes).toBeDefined();
        const doc = getCreCanonicalDocument(creParser.parse(bytes!))!;
        expect(doc.knownSpells).toHaveLength(2);
    });

    it("routes remove-item through the registered adapter", () => {
        const base = baseWithLists();
        const bytes = cre.buildRemoveEntryBytes!(base, [CRE_GROUP_LABELS.items, "Item 1"]);
        expect(bytes).toBeDefined();
        const doc = getCreCanonicalDocument(creParser.parse(bytes!))!;
        expect(doc.items).toHaveLength(0);
    });

    it("declines an unknown section", () => {
        expect(cre.buildAddEntryBytes!(baseWithLists(), ["Nonexistent"])).toBeUndefined();
    });
});
