import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register parsers + adapters
import { itmParser } from "../src/itm";
import { splParser } from "../src/spl";
import { effParser } from "../src/eff";
import type { ParsedField, ParsedGroup } from "../src/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ITM_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const SPL_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl");

function findFirstEff(): string | undefined {
    const root = path.join(REPO_ROOT, "external/infinity-engine");
    function walk(dir: string): string | undefined {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return undefined;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const hit = walk(full);
                if (hit) return hit;
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".eff")) {
                return full;
            }
        }
        return undefined;
    }
    return walk(root);
}

function findField(group: ParsedGroup, label: string): ParsedField | undefined {
    for (const child of group.fields) {
        if ("fields" in child) {
            const hit = findField(child, label);
            if (hit) return hit;
        } else if (child.name === label) {
            return child;
        }
    }
    return undefined;
}

function findGroup(group: ParsedGroup, name: string): ParsedGroup | undefined {
    for (const child of group.fields) {
        if ("fields" in child) {
            if (child.name === name) return child;
            const hit = findGroup(child, name);
            if (hit) return hit;
        }
    }
    return undefined;
}

describe("ITM display tree presentation", () => {
    const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
    const result = itmParser.parse(bytes);

    test("signature renders as ASCII string", () => {
        expect(findField(result.root, "Signature")?.value).toBe("ITM ");
    });

    test("version renders as ASCII string", () => {
        expect(findField(result.root, "Version")?.value).toBe("V1  ");
    });

    test("type field resolves to enum name", () => {
        // wm_sbook.itm has type=0 (Books)
        expect(findField(result.root, "Type")?.value).toBe("Books");
    });

    test("flags field renders as named bits or '(none)'", () => {
        const flagsField = findField(result.root, "Flags");
        expect(flagsField?.type).toBe("flags");
        expect(typeof flagsField?.value).toBe("string");
    });

    test("header usabilityFlags displays as 4 flag rows with per-byte tables", () => {
        const usability = findGroup(result.root, "Usability Flags");
        expect(usability).toBeDefined();
        // Four child rows, one per IESDP byte. Each byte carries its own
        // flag table - bytes are not interchangeable.
        expect(usability!.fields).toHaveLength(4);
        for (const field of usability!.fields) {
            expect("type" in field && field.type).toBe("flags");
        }
    });

    test("usabilityFlags slot children carry per-byte flagOptions for the renderer", () => {
        // The path-keyed presentation schema can't reach into slot children
        // (they share the array's semantic key), so the walker must
        // propagate each slot's flag table on the ParsedField directly.
        // Without this, the renderer falls back to a read-only span.
        const usability = findGroup(result.root, "Usability Flags");
        const byte1 = usability!.fields[0] as ParsedField;
        const byte2 = usability!.fields[1] as ParsedField;
        expect(byte1.flagOptions).toBeDefined();
        // Byte 1 carries class / alignment flags per IESDP - Bard should be
        // one of the entries.
        expect(Object.values(byte1.flagOptions!)).toContain("Bard");
        expect(byte2.flagOptions).toBeDefined();
        // Each byte gets its own table; the four are not the same set.
        expect(byte1.flagOptions).not.toEqual(byte2.flagOptions);
    });

    test("ability meleeAnimation displays as a 3-slot group (Overhand / Backhand / Thrust)", () => {
        const abilities = findGroup(result.root, "Abilities");
        expect(abilities).toBeDefined();
        const ability1 = findGroup(abilities!, "Ability 1");
        expect(ability1).toBeDefined();
        const meleeAnim = findGroup(ability1!, "Melee Animation");
        expect(meleeAnim).toBeDefined();
        expect(meleeAnim!.fields.map((f) => "name" in f && f.name)).toEqual(["Overhand", "Backhand", "Thrust"]);
    });

    test("resref fields surface as strings (Inventory Icon, Description Icon, Ground Icon)", () => {
        const inv = findField(result.root, "Inventory Icon");
        expect(typeof inv?.value).toBe("string");
        const desc = findField(result.root, "Description Icon");
        expect(typeof desc?.value).toBe("string");
        const ground = findField(result.root, "Ground Icon");
        expect(typeof ground?.value).toBe("string");
    });
});

describe("SPL display tree presentation", () => {
    const bytes = new Uint8Array(fs.readFileSync(SPL_FIXTURE));
    const result = splParser.parse(bytes);

    test("type field resolves to enum name (Wizard)", () => {
        expect(findField(result.root, "Type")?.value).toBe("Wizard");
    });

    test("casting graphics resolves to enum name", () => {
        const cg = findField(result.root, "Casting Graphics");
        expect(typeof cg?.value).toBe("string");
        expect(cg?.value).not.toMatch(/^\d+$/);
    });

    test("ability target resolves to enum name", () => {
        const abilities = findGroup(result.root, "Abilities");
        expect(abilities).toBeDefined();
        const ability1 = findGroup(abilities!, "Ability 1");
        expect(ability1).toBeDefined();
        const target = findField(ability1!, "Target");
        // value is one of the AbilityTargetType labels (e.g. "Living actor")
        expect(typeof target?.value).toBe("string");
    });

    test("effect opcode resolves to opname", () => {
        const effects = findGroup(result.root, "Effects");
        expect(effects).toBeDefined();
        const effect1 = findGroup(effects!, "Effect 1");
        expect(effect1).toBeDefined();
        const opcode = findField(effect1!, "Opcode");
        expect(typeof opcode?.value).toBe("string");
        expect(opcode?.value).not.toMatch(/^\d+$/);
    });

    test("effect resource surfaces as resref string", () => {
        const effects = findGroup(result.root, "Effects");
        const effect1 = findGroup(effects!, "Effect 1");
        const resource = findField(effect1!, "Resource");
        expect(typeof resource?.value).toBe("string");
    });
});

describe("Open enums - unknown values display + round-trip", () => {
    test("unknown effect opcode displays as 'Unknown (N)' and survives canonical round-trip", async () => {
        const { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } =
            await import("../src/itm/json-snapshot");
        const itmFixture = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
        const result = itmParser.parse(itmFixture);
        // Cast: the Document union loses ITM-specific shape on .document; the
        // ITM parser populates effects[] for any non-trivial fixture.
        const doc = result.document as { effects: { opcode: number }[] } | undefined;
        if (!doc?.effects?.[0]) throw new Error("ITM fixture has no effects");
        doc.effects[0].opcode = 9999;

        const json = createCanonicalItmJsonSnapshot(result);
        const loaded = loadCanonicalItmJsonSnapshot(json);
        expect((loaded.snapshot.document as { effects: { opcode: number }[] }).effects[0]?.opcode).toBe(9999);

        // Display tree shows "Unknown (9999)" for the unrecognised opcode.
        const reparsed = itmParser.parse(loaded.bytes);
        const effects = findGroup(reparsed.root, "Effects");
        const effect1 = effects ? findGroup(effects, "Effect 1") : undefined;
        const opcode = effect1 ? findField(effect1, "Opcode") : undefined;
        expect(opcode?.value).toBe("Unknown (9999)");
    });
});

describe("EFF display tree presentation", () => {
    const fixture = findFirstEff();

    if (!fixture) {
        test.skip("no EFF fixture present", () => {});
        return;
    }
    const bytes = new Uint8Array(fs.readFileSync(fixture));
    const result = effParser.parse(bytes);

    test("signature renders as ASCII string ('EFF ')", () => {
        expect(findField(result.root, "Signature")?.value).toBe("EFF ");
    });

    test("version renders as ASCII string ('V2.0')", () => {
        expect(findField(result.root, "Version")?.value).toBe("V2.0");
    });

    test("body opcode resolves to opname", () => {
        const opcode = findField(result.root, "Opcode");
        expect(typeof opcode?.value).toBe("string");
        expect(opcode?.value).not.toMatch(/^\d+$/);
    });

    test("body target resolves to enum name", () => {
        const target = findField(result.root, "Target");
        expect(typeof target?.value).toBe("string");
    });

    test("body variableName surfaces as a string field, not '(N values) padding'", () => {
        const variable = findField(result.root, "Variable Name");
        expect(variable).toBeDefined();
        expect(variable!.type).toBe("string");
    });

    test("body resource fields surface as resref strings", () => {
        const r1 = findField(result.root, "Resource");
        const r2 = findField(result.root, "Resource2");
        const r3 = findField(result.root, "Resource3");
        expect(typeof r1?.value).toBe("string");
        expect(typeof r2?.value).toBe("string");
        expect(typeof r3?.value).toBe("string");
    });
});
