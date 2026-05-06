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

    test("body resource fields surface as resref strings", () => {
        const r1 = findField(result.root, "Resource");
        const r2 = findField(result.root, "Resource2");
        const r3 = findField(result.root, "Resource3");
        expect(typeof r1?.value).toBe("string");
        expect(typeof r2?.value).toBe("string");
        expect(typeof r3?.value).toBe("string");
    });
});
