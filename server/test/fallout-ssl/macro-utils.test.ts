/**
 * Tests for fallout-ssl/macro-utils.ts - the macro tooltip, which shows a numeric constant's value in place of a
 * signature.
 */

import { describe, expect, it } from "vitest";
import { buildMacroTooltip, type MacroData } from "../../src/fallout-ssl/macro-utils";

/** The tooltip of a parameterless constant-named macro; the name is upper case so no body block is appended. */
function tooltipFor(firstline: string): string {
    const macro: MacroData = { name: "FOO", hasParams: false, firstline };
    return buildMacroTooltip(macro, "");
}

describe("buildMacroTooltip numeric constants", () => {
    it.each([
        "123",
        "(123)",
        "-123",
        "(-123)",
        "0x1F",
        "(0x1F)",
        "(1",
        "  9  ",
        "5 // five",
        "7 /* seven */",
        "8 // note // more",
        "0x10 //",
    ])("shows %j as the value", (firstline) => {
        const tooltip = tooltipFor(firstline);

        expect(tooltip).toContain(firstline.trim());
        expect(tooltip).not.toContain("macro FOO");
    });

    it.each(["1 + 2", "SOME_CONST", "12abc", "1))", "// 5", "5 // five\rmore", "x // 5"])(
        "shows %j as a macro signature",
        (firstline) => {
            expect(tooltipFor(firstline)).toContain("macro FOO");
        },
    );

    it("reads a long run of slashes followed by a line break in linear time", () => {
        // A lone line break inside the text: every "//" is a possible comment start whose `.*` stops short of the end.
        const firstline = `${"/".repeat(100_000)}\rx`;

        const start = performance.now();
        const tooltip = tooltipFor(firstline);
        const elapsed = performance.now() - start;

        expect(tooltip).toContain("macro FOO");
        expect(elapsed).toBeLessThan(500);
    });
});
