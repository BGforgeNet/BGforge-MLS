import { describe, expect, it } from "vitest";
import { enumValueLabel, enumSelectedLabel } from "../../shared/enum-label";

describe("enumValueLabel", () => {
    it("prefixes the stored value before the name", () => {
        expect(enumValueLabel(10, "Stat: Constitution Modifier")).toBe("10 Stat: Constitution Modifier");
        expect(enumValueLabel(0, "None")).toBe("0 None");
        expect(enumValueLabel(-1, "None")).toBe("-1 None");
    });

    it("renders just the value when the name already carries it, instead of doubling the number", () => {
        // MapElevation names ARE the elevation number ("0"); CRE "Ability N" embeds the index. Prefixing would
        // show the number twice ("0 0", "0 Ability 0"), so the label renders the value alone.
        expect(enumValueLabel(0, "0")).toBe("0");
        expect(enumValueLabel(1, "Ability 1")).toBe("1");
    });

    it("treats only a whole whitespace token as a double, not a digit inside a larger token", () => {
        expect(enumValueLabel(1, "BOW03")).toBe("1 BOW03");
    });

    it("renders just the value for a blank name, with no trailing space", () => {
        expect(enumValueLabel(5, "")).toBe("5");
    });
});

describe("enumSelectedLabel", () => {
    const options = { "10": "Stat: Constitution Modifier", "20": "State: Invisibility" };

    it("uses the mapped option name for a known value", () => {
        expect(enumSelectedLabel(10, options)).toBe("10 Stat: Constitution Modifier");
    });

    it("falls back to a clean '<value> Unknown' for an out-of-range value, not the parser's 'Unknown (N)'", () => {
        expect(enumSelectedLabel(0, options)).toBe("0 Unknown");
        expect(enumSelectedLabel(99, undefined)).toBe("99 Unknown");
    });
});
