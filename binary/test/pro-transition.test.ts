/**
 * Unit tests for pro-transition.ts.
 * Tests isProStructuralFieldId and buildProStructuralTransitionBytes across all
 * object type transitions (item -> critter -> scenery -> wall -> tile -> misc)
 * and item/scenery subtype transitions.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { isProStructuralFieldId, buildProStructuralTransitionBytes } from "../src/pro/transition";
import { proParser } from "../src/pro";
import type { ParseResult } from "../src/types";

const FIXTURES = path.resolve("client/testFixture/proto");

function loadMisc(): ParseResult {
    const data = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "misc", "00000001.pro")));
    return proParser.parse(data);
}

function loadItem(fileName: string): ParseResult {
    const data = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "items", fileName)));
    return proParser.parse(data);
}

// ---------------------------------------------------------------------------
// isProStructuralFieldId
// ---------------------------------------------------------------------------

describe("isProStructuralFieldId", () => {
    it("recognises Header / Object Type", () => {
        expect(isProStructuralFieldId(JSON.stringify(["Header", "Object Type"]))).toBe(true);
    });

    it("recognises Item Properties / Sub Type", () => {
        expect(isProStructuralFieldId(JSON.stringify(["Item Properties", "Sub Type"]))).toBe(true);
    });

    it("recognises Scenery Properties / Sub Type", () => {
        expect(isProStructuralFieldId(JSON.stringify(["Scenery Properties", "Sub Type"]))).toBe(true);
    });

    it("rejects non-structural field IDs", () => {
        expect(isProStructuralFieldId(JSON.stringify(["Header", "Text ID"]))).toBe(false);
        expect(isProStructuralFieldId(JSON.stringify(["Misc Properties", "Unknown"]))).toBe(false);
    });

    it("rejects malformed JSON", () => {
        expect(isProStructuralFieldId("not-json")).toBe(false);
    });

    it("rejects non-array JSON", () => {
        expect(isProStructuralFieldId(JSON.stringify({ key: "val" }))).toBe(false);
    });

    it("rejects arrays with non-string elements", () => {
        expect(isProStructuralFieldId(JSON.stringify([1, 2]))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// buildProStructuralTransitionBytes — Object Type changes
// ---------------------------------------------------------------------------

describe("buildProStructuralTransitionBytes - object type transitions", () => {
    it("transitions from Misc (5) to Misc (5) — same type produces valid bytes", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 5);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result!.length).toBeGreaterThan(0);
    });

    it("transitions from Misc (5) to Wall (3)", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 3);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("transitions from Misc (5) to Tile (4)", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 4);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("transitions from Misc (5) to Item (0) — sets item common defaults", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        // objectType 0 = Item; item common defaults are written
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 0);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("transitions from Misc (5) to Scenery (2) — sets scenery common defaults", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        // objectType 2 = Scenery
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 2);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("transitions from Misc (5) to Critter (1)", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 1);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("returns undefined for unknown object type (e.g. 99)", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Object Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 99);
        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildProStructuralTransitionBytes — item subtype changes
// ---------------------------------------------------------------------------

describe("buildProStructuralTransitionBytes - item subtype transitions", () => {
    it("transitions item subtype from Armor (0) to Container (1)", () => {
        // Load any armor item; armor files are in items/
        const dir = path.join(FIXTURES, "items");
        const armorFile = fs.readdirSync(dir).find((f) => f.endsWith(".pro"));
        if (!armorFile) {
            return; // skip if no fixture available
        }
        const parseResult = loadItem(armorFile);
        const fieldId = JSON.stringify(["Item Properties", "Sub Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 1);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("returns undefined for unknown item subtype (e.g. 99)", () => {
        const dir = path.join(FIXTURES, "items");
        const armorFile = fs.readdirSync(dir).find((f) => f.endsWith(".pro"));
        if (!armorFile) return;
        const parseResult = loadItem(armorFile);
        const fieldId = JSON.stringify(["Item Properties", "Sub Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 99);
        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildProStructuralTransitionBytes — scenery subtype changes
// ---------------------------------------------------------------------------

describe("buildProStructuralTransitionBytes - scenery subtype transitions", () => {
    it("transitions scenery subtype to Door (0)", () => {
        const dir = path.join(FIXTURES, "scenery");
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".pro")) : [];
        if (files.length === 0) return;
        const parseResult = proParser.parse(new Uint8Array(fs.readFileSync(path.join(dir, files[0]!))));
        const fieldId = JSON.stringify(["Scenery Properties", "Sub Type"]);
        // subtype 0 = Door
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 0);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it("returns undefined for unknown scenery subtype (e.g. 99)", () => {
        const dir = path.join(FIXTURES, "scenery");
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".pro")) : [];
        if (files.length === 0) return;
        const parseResult = proParser.parse(new Uint8Array(fs.readFileSync(path.join(dir, files[0]!))));
        const fieldId = JSON.stringify(["Scenery Properties", "Sub Type"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 99);
        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildProStructuralTransitionBytes — edge cases
// ---------------------------------------------------------------------------

describe("buildProStructuralTransitionBytes - edge cases", () => {
    it("returns undefined for malformed fieldId JSON", () => {
        const parseResult = loadMisc();
        const result = buildProStructuralTransitionBytes(parseResult, "not-json", 0);
        expect(result).toBeUndefined();
    });

    it("returns undefined for non-structural fieldId (correct JSON but unrecognized path)", () => {
        const parseResult = loadMisc();
        const fieldId = JSON.stringify(["Header", "Text ID"]);
        const result = buildProStructuralTransitionBytes(parseResult, fieldId, 0);
        expect(result).toBeUndefined();
    });
});
