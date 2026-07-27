import { describe, expect, test } from "vitest";
import { capTooltip, cleanDescription, descToCamelCase, translateField } from "../src/translate.ts";

describe("translateField - scalar codecs", () => {
    test.each([
        ["byte", "u8"],
        ["word", "u16"],
        ["dword", "u32"],
    ])("type %s maps to %s codec, carrying the cleaned desc as a tooltip", (type, codec) => {
        const result = translateField({ desc: "Anything", type, id: "foo" });
        expect(result.name).toBe("foo");
        expect(result.fieldSource).toBe(`{ codec: ${codec}, description: "Anything" }`);
        expect(result.description).toBe("Anything");
    });
});

describe("translateField - strref", () => {
    test("strref maps to i32 and keeps the distinction as a spec property", () => {
        const result = translateField({ desc: "Anything", type: "strref", id: "foo" });
        expect(result.fieldSource).toBe('{ codec: i32, strref: true, description: "Anything" }');
    });

    // IESDP marks some strrefs `unused` (SPL identified_name / identified_desc, "usually -1"). Those are
    // strrefs the engine ignores, not non-strrefs - dropping the flag there would under-mark the format.
    test("an unused strref still carries the flag, without the dropped tooltip", () => {
        const result = translateField({ desc: "Anything", type: "strref", unused: true });
        expect(result.fieldSource).toBe("{ codec: i32, strref: true }");
    });

    test("a plain dword carries no strref flag", () => {
        const result = translateField({ desc: "Anything", type: "dword", id: "foo" });
        expect(result.fieldSource).not.toContain("strref");
    });
});

describe("translateField - fixed-count arrays", () => {
    test("byte with mult emits arraySpec over u8", () => {
        const result = translateField({ desc: "Bitmask", type: "byte", mult: 4, id: "usability_flags" });
        expect(result.fieldSource).toBe("arraySpec({ element: { codec: u8 }, count: 4 })");
    });
});

describe("translateField - chars primitive", () => {
    test("char array with length emits charsSpec(length)", () => {
        const result = translateField({ desc: "Signature", type: "char array", length: 4, id: "signature" });
        expect(result.fieldSource).toBe("charsSpec(4)");
        expect(result.imports).toEqual(["charsSpec"]);
    });

    test("resref emits charsSpec(8)", () => {
        const result = translateField({ desc: "Replacement", type: "resref", id: "replacement" });
        expect(result.fieldSource).toBe("charsSpec(8)");
        expect(result.imports).toEqual(["charsSpec"]);
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
    ])("%j -> %j", (desc, expected) => {
        expect(descToCamelCase(desc)).toBe(expected);
    });
});

describe("translateField - derived name when id absent", () => {
    test("derives name from desc via descToCamelCase and keeps the cleaned desc as tooltip", () => {
        const result = translateField({ desc: "[Flags](#Header_Flags)", type: "dword" });
        expect(result.name).toBe("flags");
        expect(result.fieldSource).toBe('{ codec: u32, description: "Flags" }');
        expect(result.description).toBe("Flags");
    });
});

describe("translateField - no description for unused bytes", () => {
    test("an unused field carries no tooltip", () => {
        const result = translateField({ desc: "Unused", type: "byte", unused: true });
        expect(result.description).toBeUndefined();
        expect(result.fieldSource).toBe("{ codec: u8 }");
    });
});

describe("cleanDescription", () => {
    test.each([
        // Markdown link -> text only.
        ["[Item type](#Header_ItemType)", "Item type"],
        // HTML tags (anchor, bold, code) stripped; wording kept.
        ['<b><a name="itmv1_Header_0x38">Stack amount</a></b>', "Stack amount"],
        // Parentheticals are KEPT (unlike descToCamelCase) - they carry real info.
        ["Min Strength (unused in BG1)", "Min Strength (unused in BG1)"],
        // Jekyll/Liquid directives removed, the prose they wrap kept.
        ["A note {% capture x %}kept text{% endcapture %} {% include info.html %}", "A note kept text"],
        // YAML block-scalar newlines collapse to single spaces.
        ["Line one\nLine two", "Line one Line two"],
        // Typographic Unicode folds to ASCII (long arrow in enum lists, en dash, smart quotes).
        ["0 \u27F6 None \u2013 a \u201Cval\u201D", '0 -> None - a "val"'],
    ])("%j -> %j", (desc, expected) => {
        expect(cleanDescription(desc)).toBe(expected);
    });

    test("output is pure ASCII even from heavily-typographic input", () => {
        const out = cleanDescription("a \u2192 b \u2264 c \u2265 d \u2260 e \u2026 f \u00D7 g");
        expect([...out].every((ch) => (ch.codePointAt(0) ?? 0) < 128)).toBe(true);
        expect(out).toBe("a -> b <= c >= d != e ... f x g");
    });
});

describe("capTooltip", () => {
    test("a short description passes through whole and is not truncated", () => {
        expect(capTooltip("Min Charisma")).toEqual({ text: "Min Charisma", truncated: false });
    });

    test("a long description is cut at the first sentence end before the cap", () => {
        const long = "Attack type - 0 -> None - 1 -> Melee. " + "x".repeat(400);
        const r = capTooltip(long);
        expect(r.truncated).toBe(true);
        expect(r.text).toBe("Attack type - 0 -> None - 1 -> Melee.");
    });

    test("with no early sentence break, it cuts at a word boundary and appends an ellipsis", () => {
        const long = "word ".repeat(80).trim();
        const r = capTooltip(long);
        expect(r.truncated).toBe(true);
        expect(r.text.endsWith(" ...")).toBe(true);
        expect(r.text.length).toBeLessThan(long.length);
    });
});

describe("translateField - doc link", () => {
    const base = "https://example.test/itm_v1.htm";
    test("a capped description emits a page-level docUrl", () => {
        const longDesc = "Attack type - lots of detail here. " + "more prose ".repeat(40);
        const r = translateField({ desc: longDesc, type: "byte", id: "attack_type" }, base);
        expect(r.docUrl).toBe(base);
        expect(r.fieldSource).toContain(`docUrl: ${JSON.stringify(base)}`);
    });

    test("a short (un-capped) description emits no docUrl even when a base is given", () => {
        const r = translateField({ desc: "Min Charisma", type: "word", id: "min_charisma" }, base);
        expect(r.docUrl).toBeUndefined();
        expect(r.fieldSource).toBe('{ codec: u16, description: "Min Charisma" }');
    });

    test("no base url means no docUrl", () => {
        const longDesc = "Attack type - lots of detail here. " + "more prose ".repeat(40);
        const r = translateField({ desc: longDesc, type: "byte", id: "attack_type" });
        expect(r.docUrl).toBeUndefined();
    });
});

describe("translateField - id normalization", () => {
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
