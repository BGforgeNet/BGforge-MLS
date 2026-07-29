import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "@bgforge/binary-editor";
import {
    enumOptionList,
    decomposeFlags,
    composeFlags,
    controlKind,
    filterOptions,
    parseCustomValue,
    valueTier,
    dropdownWidth,
    controlWidthClass,
    rangeTooltip,
} from "../../../src/binary-editor/webview/state/controls";

const enumRow: Row = {
    id: "0",
    namePath: ["Race"],
    depth: 1,
    kind: "field",
    name: "Race",
    valueType: "enum",
    rawValue: 1,
    displayValue: "Mutant",
    editable: true,
    enumOptions: { "0": "Human", "1": "Mutant" },
};
// flagOptions are keyed by bit MASK, matching real producer output (walkStruct emits
// stringifyKeys(fs.flags), and every PRO/IE flag table is mask-keyed: { "1": ..., "4": ... }).
const flagRow: Row = {
    id: "1",
    namePath: ["Flags"],
    depth: 1,
    kind: "field",
    name: "Flags",
    valueType: "flags",
    rawValue: 5,
    displayValue: "5",
    editable: true,
    flagOptions: { "1": "Visible", "4": "Dead" },
};

describe("controls", () => {
    it("classifies control kind by valueType", () => {
        expect(controlKind(enumRow)).toBe("enum");
        expect(controlKind(flagRow)).toBe("flags");
        expect(controlKind({ ...enumRow, valueType: "uint16", enumOptions: undefined })).toBe("number");
        expect(controlKind({ ...enumRow, valueType: "string", enumOptions: undefined })).toBe("string");
    });

    // A resref field becomes a picker only with a game behind it: `refExt` is what the host stamps when the
    // record was opened from one, and without it there is nothing to suggest.
    it("classifies a resref field as a resource picker only when a game named its type", () => {
        const resref: Row = {
            ...enumRow,
            valueType: "string",
            enumOptions: undefined,
            size: 8,
            rawValue: "ISW1H01",
            ref: { kind: "resource", type: "BAM" },
        };

        expect(controlKind(resref)).toBe("string");
        expect(controlKind({ ...resref, refExt: "BAM" })).toBe("resource");
    });

    it("builds an enum option list with value-prefixed labels, injecting '<n> Unknown' for an out-of-range value", () => {
        // Every option label carries its stored value as a prefix ("<value> <name>"), so a dropdown reads
        // against the raw byte uniformly across formats; the synthetic out-of-range option follows the same form.
        expect(enumOptionList(enumRow)).toEqual([
            { value: 0, label: "0 Human" },
            { value: 1, label: "1 Mutant" },
        ]);
        const oor = enumOptionList({ ...enumRow, rawValue: 9 });
        expect(oor).toContainEqual({ value: 9, label: "9 Unknown" });
        // A blank label (e.g. an item with no ResRef) renders as just the value, with no trailing space.
        expect(enumOptionList({ ...enumRow, enumOptions: { "5": "" }, rawValue: 5 })).toContainEqual({
            value: 5,
            label: "5",
        });
    });

    it("renders just the value when the name already carries it, instead of doubling the number", () => {
        // MapElevation names ARE the elevation number ("0"); CRE "Ability N" embeds the index. Prefixing would
        // show the number twice ("0 0", "0 Ability 0"), so the option renders the value alone.
        expect(enumOptionList({ ...enumRow, enumOptions: { "0": "0", "1": "1" }, rawValue: 0 })).toEqual([
            { value: 0, label: "0" },
            { value: 1, label: "1" },
        ]);
        expect(
            enumOptionList({ ...enumRow, enumOptions: { "0": "Ability 0", "1": "Ability 1" }, rawValue: 0 }),
        ).toEqual([
            { value: 0, label: "0" },
            { value: 1, label: "1" },
        ]);
        // A name that merely contains the digit as part of a larger token is NOT a double (value 1 vs "BOW03").
        expect(enumOptionList({ ...enumRow, enumOptions: { "1": "BOW03" }, rawValue: 1 })).toEqual([
            { value: 1, label: "1 BOW03" },
        ]);
    });

    it("decomposes and recomposes flag bits by mask", () => {
        // rawValue 5 = masks 0x1 and 0x4 set
        expect(decomposeFlags(flagRow)).toEqual([
            { mask: 1, label: "Visible", set: true },
            { mask: 4, label: "Dead", set: true },
        ]);
        expect(composeFlags(5, 1, false)).toBe(4); // clear mask 0x1
        expect(composeFlags(4, 1, true)).toBe(5); // set mask 0x1
    });

    it("handles a high-bit mask without producing a negative value", () => {
        // 0x80000000 would go negative under signed bitwise ops without the unsigned guard.
        expect(composeFlags(0, 0x80000000, true)).toBe(0x80000000);
        expect(composeFlags(0xffffffff, 0x80000000, false)).toBe(0x7fffffff);
        const highRow: Row = { ...flagRow, rawValue: 0x80000000, flagOptions: { "2147483648": "High" } };
        expect(decomposeFlags(highRow)).toEqual([{ mask: 0x80000000, label: "High", set: true }]);
    });
});

describe("valueTier", () => {
    // A plain numeric field (not enum/flags/string). controlKind() -> "number".
    const numberRow: Row = { ...enumRow, valueType: "uint16", enumOptions: undefined, rawValue: 5, displayValue: "5" };
    const stringRow = (size: number): Row => ({ ...numberRow, valueType: "string", size, displayValue: "x" });

    it("sizes plain decimal numbers by byte width: 8/16-bit small, 24/32-bit medium", () => {
        // The small box shows ~6 chars. An 8/16-bit field's max (incl. sign) fits: uint8 "255", int16 "-32768".
        expect(valueTier({ ...numberRow, valueType: "uint8", size: 1 })).toBe("s");
        expect(valueTier({ ...numberRow, valueType: "int16", size: 2 })).toBe("s");
        // A 24/32-bit field can show 8-11 digits (e.g. a strref 536898807, a -2147483648), which overflows the
        // small box, so it takes the medium box - the same width hex32 (also 32-bit) already uses.
        expect(valueTier({ ...numberRow, valueType: "uint24", size: 3 })).toBe("m");
        expect(valueTier({ ...numberRow, valueType: "uint32", size: 4 })).toBe("m");
        expect(valueTier({ ...numberRow, valueType: "int32", size: 4 })).toBe("m");
        // Missing size (defensive): falls back to the small box.
        expect(valueTier(numberRow)).toBe("s");
    });

    it("puts hex-formatted numbers in the medium tier", () => {
        expect(valueTier({ ...numberRow, numericFormat: "hex32" })).toBe("m");
    });

    // A strref-declaring field is sized for the dialog.tlk line it can show, not for the number's digits.
    it("widens a strref field to the mid-large tier", () => {
        expect(valueTier({ ...numberRow, valueType: "int32", size: 4, ref: { kind: "strref" } })).toBe("ml");
    });

    // Keyed on the FIELD's declaration, never on whether THIS value resolved - keying on the resolved text
    // sized siblings of one field differently and rendered the sound-slot grid ragged.
    it("widens a strref field whose line the game did not resolve", () => {
        const unresolved: Row = { ...numberRow, valueType: "int32", size: 4, ref: { kind: "strref" }, rawValue: -1 };

        expect(valueTier(unresolved)).toBe("ml");
    });

    it("sizes string fields by their char-array length", () => {
        expect(valueTier(stringRow(4))).toBe("s"); // <= 6 chars
        expect(valueTier(stringRow(6))).toBe("s");
        expect(valueTier(stringRow(8))).toBe("m"); // resref: 7-12 chars
        expect(valueTier(stringRow(12))).toBe("m");
        expect(valueTier(stringRow(16))).toBe("ml"); // 13-20 chars -> mid-large
        expect(valueTier(stringRow(32))).toBe("l"); // long char array
    });

    // Enums no longer route through valueTier - they have their own measured `dropdownWidth` (decoupled from
    // the text tiers). Its bucketing needs real text metrics (canvas), so it is verified in the Playwright
    // render harnesses (render-itm/render-cre), not here. In jsdom (no 2d context) it fails wide to dd-5.
});

describe("dropdownWidth", () => {
    it("fails wide when text metrics are unavailable (jsdom has no 2d canvas context)", () => {
        // Without a measurable font the width can't be computed, so a dropdown must never clip - it takes the
        // widest box. Pinned as the last class in the scale, so adding a wider box moves this with it.
        expect(dropdownWidth(enumRow)).toBe("dd-6");
    });

    describe("with a stubbed DOM and measurable canvas context", () => {
        // Stub `document` so dropdownMeasure proceeds past the `typeof document === "undefined"` guard
        // and into the canvas branch. The stub provides a minimal canvas whose getContext returns a fake
        // 2d context with a measureText implementation that returns a fixed advance width per character.
        // This exercises the ch-callback closure and the DROPDOWN_BOX_CH tier-selection logic.
        let restoreDocument: (() => void) | undefined;

        beforeEach(() => {
            // measureCanvas is a module-level singleton; null it out before each test so the stub
            // canvas is freshly created (avoids cross-test canvas contamination when the real document
            // is absent but the cached canvas from a previous run lingers).
            // We do this by stubbing `document` before the module initialises the variable.
            const fakeCtx = {
                font: "",
                measureText: (text: string) => ({ width: text.length * 8 }), // 8px per char, 1ch = 8px
                // getComputedStyle fallback: fontStyle/fontWeight/fontSize/lineHeight/fontFamily
            };
            const fakeCanvas = {
                getContext: (type: string) => (type === "2d" ? fakeCtx : null),
            };
            const fakeBody = { style: {} };
            const fakeDocument = {
                createElement: (_tag: string) => fakeCanvas,
                querySelector: (_sel: string) => null, // forces fallback to document.body
                body: fakeBody,
            };
            vi.stubGlobal("document", fakeDocument);
            vi.stubGlobal("getComputedStyle", (_el: unknown) => ({
                fontStyle: "normal",
                fontWeight: "400",
                fontSize: "14px",
                lineHeight: "1.5",
                fontFamily: "monospace",
            }));
            restoreDocument = () => {
                vi.unstubAllGlobals();
            };
        });

        afterEach(() => {
            restoreDocument?.();
        });

        it("picks the narrowest box that fits the longest option label", () => {
            // enumRow options: ["0 Human" (7 chars), "1 Mutant" (8 chars)].
            // At 8px/char and a 1ch=8px ratio, "1 Mutant" -> 8ch wide.
            // needed = 8 + DROPDOWN_CHROME_CH (4.5) = 12.5ch -> first box >= 12.5 is 16ch (dd-2).
            const result = dropdownWidth(enumRow);
            expect(["dd-1", "dd-2", "dd-3", "dd-4", "dd-5", "dd-6"]).toContain(result);
            // With short labels (<=12ch) it should land well below the widest box (the no-metrics fallback)
            expect(result).toBe("dd-2");
        });

        it("saturates to the widest box when no box accommodates the longest label", () => {
            // Past the top of the scale (46ch of box, minus chrome) there is nothing wider to pick, so it
            // saturates. That saturation is what silently clipped a CRE kit while the scale stopped at 32ch,
            // so the label here is deliberately beyond ANY plausible option rather than merely long.
            const longRow: import("@bgforge/binary-editor").Row = {
                ...enumRow,
                enumOptions: { "0": "A".repeat(60) }, // 60 chars -> 60ch, past the 46ch box even before chrome
                rawValue: 0,
            };
            const result = dropdownWidth(longRow);
            expect(result).toBe("dd-6");
        });

        // The real case the top box was added for: a CRE kit renders its packed id beside the game's own
        // identifier. At 1ch/char under the stub this is 33ch + 4.5 chrome = 37.5ch, which fits the 46ch box
        // and did NOT fit the 32ch one - the clip the cross-format sweep caught.
        it("fits the longest real kit label without saturating below it", () => {
            const kitRow: import("@bgforge/binary-editor").Row = {
                ...enumRow,
                numericFormat: "hex32",
                enumOptions: { "8388608": "MAGESCHOOL_NECROMANCER" },
                rawValue: 8388608,
            };

            expect(dropdownWidth(kitRow)).toBe("dd-6");
        });

        // Fit-contract regression pin: a dropdown's chosen box must always have room for its longest option
        // (box width minus trigger chrome >= the option's measured width), and pick the SMALLEST such box.
        // This guards the WIDTH LOGIC against a future edit to the box tiers / chrome / boundaries that would
        // silently start clipping. It does NOT cover whether a renderer APPLIES the class - a dropdown rendered
        // through a grid/matrix cell (CellControl) carries no width class at all; that render-path defect is
        // caught by the cross-format clip sweep (binary-editor/test/harness/render-clip-sweep.mts), since the
        // canvas-metric path here is unavailable in jsdom and the project verifies real bucketing in the harness.
        it("picks the smallest box that fits the longest option, across the tier range", () => {
            // Mirror the private scale in state/controls.ts (DROPDOWN_BOX_CH / DROPDOWN_CHROME_CH). Kept in
            // sync deliberately: if those change in code without updating here, this pin fails - the prompt to
            // re-confirm nothing clips. Stub metrics are 8px/char with 1ch=8px, so a label of N chars is N ch.
            const BOX_CH = [10, 16, 20, 25, 32, 46];
            const CLASS = ["dd-1", "dd-2", "dd-3", "dd-4", "dd-5", "dd-6"] as const;
            const CHROME_CH = 4.5;
            const expectedClass = (renderedCh: number): string => {
                const needed = renderedCh + CHROME_CH;
                const idx = BOX_CH.findIndex((box) => box >= needed);
                return idx === -1 ? "dd-5" : CLASS[idx]!;
            };
            // enumValueLabel renders a decimal option as "<value> <name>", so value 0 prefixes "0 " (2 chars).
            for (const name of ["abc", "Lawful good", "0x32 neutral!!", "twentychars__padxx!", "A".repeat(26)]) {
                const renderedCh = name.length + 2; // "0 " + name, at 1ch/char under the stub
                const row: import("@bgforge/binary-editor").Row = {
                    ...enumRow,
                    enumOptions: { "0": name },
                    rawValue: 0,
                };
                expect(dropdownWidth(row)).toBe(expectedClass(renderedCh));
            }
        });
    });
});

const sampleOptions = [
    { value: 0, label: "None" },
    { value: 1, label: "Fire Damage" },
    { value: 2, label: "Cold Damage" },
    { value: 3, label: "Fireball" },
    { value: 100, label: "Charm Animal" },
];

describe("rangeTooltip", () => {
    const numberRow: Row = { ...enumRow, valueType: "uint8", enumOptions: undefined, rawValue: 5 };

    it("renders the resolved min/max as tooltip text", () => {
        expect(rangeTooltip({ ...numberRow, min: 0, max: 255 })).toBe("0 to 255");
        expect(rangeTooltip({ ...numberRow, min: 0, max: 8 })).toBe("0 to 8");
    });

    it("returns undefined when the row carries no resolved range (enum/flags/non-numeric fields)", () => {
        expect(rangeTooltip(numberRow)).toBeUndefined();
        expect(rangeTooltip(enumRow)).toBeUndefined();
        expect(rangeTooltip(flagRow)).toBeUndefined();
    });
});

describe("filterOptions", () => {
    it("returns all options for an empty query", () => {
        expect(filterOptions(sampleOptions, "")).toEqual(sampleOptions);
    });

    it("returns all options for a whitespace-only query", () => {
        expect(filterOptions(sampleOptions, "   ")).toEqual(sampleOptions);
    });

    it("filters case-insensitively", () => {
        const result = filterOptions(sampleOptions, "fire");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 3, label: "Fireball" });
        expect(result).not.toContainEqual({ value: 2, label: "Cold Damage" });
    });

    it("matches substrings, not just prefixes", () => {
        const result = filterOptions(sampleOptions, "damage");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 2, label: "Cold Damage" });
        expect(result).not.toContainEqual({ value: 3, label: "Fireball" });
    });

    it("returns empty array when no options match", () => {
        expect(filterOptions(sampleOptions, "zzznomatch")).toEqual([]);
    });
});

describe("parseCustomValue", () => {
    it("returns a finite integer for a numeric string", () => {
        expect(parseCustomValue("0")).toBe(0);
        expect(parseCustomValue("42")).toBe(42);
        expect(parseCustomValue("-5")).toBe(-5);
    });

    it("returns undefined for non-numeric input", () => {
        expect(parseCustomValue("fire")).toBeUndefined();
        expect(parseCustomValue("")).toBeUndefined();
        expect(parseCustomValue("  ")).toBeUndefined();
    });

    it("accepts a leading plus sign", () => {
        expect(parseCustomValue("+5")).toBe(5);
    });

    it("returns undefined for non-integer numeric strings", () => {
        expect(parseCustomValue("3.14")).toBeUndefined();
        expect(parseCustomValue("1e2")).toBeUndefined();
    });

    it("returns undefined for hex strings (Number would coerce 0xff -> 255)", () => {
        expect(parseCustomValue("0xff")).toBeUndefined();
        expect(parseCustomValue("0xef")).toBeUndefined();
    });

    it("returns undefined for Infinity and NaN", () => {
        expect(parseCustomValue("Infinity")).toBeUndefined();
        expect(parseCustomValue("NaN")).toBeUndefined();
    });
});

/**
 * The one place a row is mapped to its width class. Every renderer applies it, and a control rendered through
 * a path that skips it carries no class and clips its value.
 */
describe("controlWidthClass", () => {
    const base: Row = {
        id: "1",
        namePath: ["Icon"],
        depth: 1,
        kind: "field",
        name: "Inventory Icon",
        valueType: "string",
        size: 8,
        rawValue: "ISW1H01",
        displayValue: "ISW1H01",
        editable: true,
    };

    it("gives a flags field no width class (it is full-width)", () => {
        const flags: Row = { ...base, valueType: "flags", flagOptions: { "1": "Visible" }, rawValue: 1 };
        expect(controlWidthClass(flags)).toBe("");
    });

    it("puts a text field on the tier scale and an enum on the dropdown scale", () => {
        expect(controlWidthClass(base)).toBe("tier-m"); // char[8] resref
        const dropdown: Row = { ...base, valueType: "enum", enumOptions: { "0": "Books" }, rawValue: 0 };
        // jsdom has no 2d canvas context, so the measured dropdown scale fails wide - see dropdownWidth.
        expect(controlWidthClass(dropdown)).toBe("dd-6");
    });

    // A resref picker is sized from the FIELD's char capacity, not its options: the list may not have loaded
    // yet, and every option is a resref of that same char array anyway. So unlike an enum it does not depend
    // on text metrics, and lands on a real box rather than the fail-wide fallback. (A resref is always char[8]
    // - a wider char array is not declared a resource ref at all - so that is the only size to pin.)
    it("sizes a resref picker from the field's char capacity, not its options", () => {
        const picker: Row = { ...base, ref: { kind: "resource", type: "BAM" }, refExt: "BAM" };
        expect(controlWidthClass(picker)).toBe("dd-2");
        // Same field without a game behind it is a plain text box on the tier scale.
        expect(controlWidthClass({ ...picker, refExt: undefined })).toBe("tier-m");
    });
});
