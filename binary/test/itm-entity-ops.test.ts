import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument } from "../src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../src/itm/canonical-writer";
import {
    defaultItmAbility,
    defaultItmEffect,
    itmAbilitiesCollection,
    itmEffectsCollection,
} from "../src/itm/entity-ops";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const hasFixture = fs.existsSync(FIXTURE);

describe("ITM default elements + collections", () => {
    it("collection descriptors expose the right capabilities", () => {
        expect(itmAbilitiesCollection.addable).toBe(true);
        expect(itmAbilitiesCollection.removable).toBe(true);
        expect(itmEffectsCollection.addable).toBe(false); // owner-ambiguous; gated off
        expect(itmEffectsCollection.removable).toBe(true);
    });

    it("defaultItmAbility has featureBlockCount 0 and featureBlockIndex 0", () => {
        const a = defaultItmAbility();
        expect(a.featureBlockCount).toBe(0);
        expect(a.featureBlockIndex).toBe(0);
    });

    it("a default ability appended to a real ITM round-trips with featureBlockCount 0", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const origLen = doc.abilities.length;
        const next = { ...doc, abilities: [...doc.abilities, defaultItmAbility()] };
        const reparsed = itmParser.parse(serializeItmCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getItmCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.abilities.length).toBe(origLen + 1);
        const newAbility = reparsedDoc.abilities.at(-1);
        expect(newAbility).toBeDefined();
        expect(newAbility?.featureBlockCount).toBe(0);
        expect(newAbility?.featureBlockIndex).toBe(0);
    });

    it("default effect round-trips when appended with a default ability that owns it", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        // Append a default effect to doc.effects and a new ability whose
        // featureBlockIndex points at it and featureBlockCount is 1.
        // This validates that the default effect serializes cleanly;
        // the real owner-relink is handled in Tasks 5/6.
        const effectIndex = doc.effects.length;
        const newAbility = { ...defaultItmAbility(), featureBlockIndex: effectIndex, featureBlockCount: 1 };
        const next = {
            ...doc,
            abilities: [...doc.abilities, newAbility],
            effects: [...doc.effects, defaultItmEffect()],
        };
        const reparsed = itmParser.parse(serializeItmCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getItmCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.effects.length).toBe(doc.effects.length + 1);
        const reparsedAbility = reparsedDoc.abilities.at(-1);
        expect(reparsedAbility).toBeDefined();
        expect(reparsedAbility?.featureBlockCount).toBe(1);
    });

    it("collection read/write round-trip preserves the array via itmAbilitiesCollection", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const abilities = itmAbilitiesCollection.read(doc);
        const rebuilt = itmAbilitiesCollection.write(doc, abilities);
        expect(rebuilt.abilities.length).toBe(doc.abilities.length);
    });

    it("collection read/write round-trip preserves the array via itmEffectsCollection", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const effects = itmEffectsCollection.read(doc);
        const rebuilt = itmEffectsCollection.write(doc, effects);
        expect(rebuilt.effects.length).toBe(doc.effects.length);
    });
});
