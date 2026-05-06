import { describe, expect, test } from "vitest";
import { descToCamelCase, translateField } from "../src/translate.ts";

describe("translateField — scalar codecs", () => {
    test.each([
        ["byte", "u8"],
        ["word", "u16"],
        ["dword", "u32"],
        ["strref", "i32"],
    ])("type %s maps to %s codec", (type, codec) => {
        const result = translateField({ desc: "Anything", type, id: "foo" });
        expect(result.name).toBe("foo");
        expect(result.fieldSource).toBe(`{ codec: ${codec} }`);
    });
});

describe("translateField — fixed-count arrays", () => {
    test("char array with length emits arraySpec over u8", () => {
        const result = translateField({ desc: "Signature", type: "char array", length: 4, id: "signature" });
        expect(result.fieldSource).toBe("arraySpec({ element: { codec: u8 }, count: 4 })");
    });

    test("byte with mult emits arraySpec over u8", () => {
        const result = translateField({ desc: "Bitmask", type: "byte", mult: 4, id: "usability_flags" });
        expect(result.fieldSource).toBe("arraySpec({ element: { codec: u8 }, count: 4 })");
    });

    test("resref emits 8-byte u8 array (canonical converts to string later)", () => {
        const result = translateField({ desc: "Replacement", type: "resref", id: "replacement" });
        expect(result.fieldSource).toBe("arraySpec({ element: { codec: u8 }, count: 8 })");
    });
});

describe("descToCamelCase", () => {
    test.each([
        ["Flags", "flags"],
        ["Min Charisma", "minCharisma"],
        ["Lore to ID", "loreToId"],
        ["[Flags](#Header_Flags)", "flags"],
        ["[Kit Usability 1](#Header_KitUsability)", "kitUsability1"],
        ['<b><a name="itmv1_Header_0x38">Stack amount</a></b>', "stackAmount"],
        ["Description icon (BAM)", "descriptionIcon"],
    ])("%j → %j", (desc, expected) => {
        expect(descToCamelCase(desc)).toBe(expected);
    });
});

describe("translateField — derived name when id absent", () => {
    test("derives name from desc via descToCamelCase", () => {
        const result = translateField({ desc: "[Flags](#Header_Flags)", type: "dword" });
        expect(result.name).toBe("flags");
        expect(result.fieldSource).toBe("{ codec: u32 }");
    });
});

describe("translateField — id normalization", () => {
    test.each([
        ["min_strength_bonus", "minStrengthBonus"],
        ["unidentified_name", "unidentifiedName"],
        ["type", "type"],
        ["extended_headers_offset", "extendedHeadersOffset"],
    ])("%j becomes %j", (id, camelCase) => {
        const result = translateField({ desc: "anything", type: "byte", id });
        expect(result.name).toBe(camelCase);
    });
});
