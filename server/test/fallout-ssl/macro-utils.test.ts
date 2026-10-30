/**
 * Tests for fallout-ssl/macro-utils.ts - the macro tooltip, which shows a numeric constant's value in place of a
 * signature.
 */

import { describe, expect, it } from "vitest";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
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
        "6 /* a */ /* b */",
        "/* lead */ 4",
        "2 /* a */ b */",
    ])("shows %j as the value", (firstline) => {
        const tooltip = tooltipFor(firstline);

        expect(tooltip).toContain(firstline.trim());
        expect(tooltip).not.toContain("macro FOO");
    });

    it.each([
        "1 + 2",
        "SOME_CONST",
        "12abc",
        "1))",
        "// 5",
        "5 // five\rmore",
        "x // 5",
        "3 /* a */ 4",
        "1 /* a",
        "1 /*/",
        "2 /* a\r*/",
    ])("shows %j as a macro signature", (firstline) => {
        expect(tooltipFor(firstline)).toContain("macro FOO");
    });

    it("reads a long run of block comment openers with no closer in linear time", () => {
        // Each opener is a possible start of a comment whose `.*` runs to the end of the text and finds no closer.
        const firstline = "/* ".repeat(30_000);

        let tooltip = "";
        const elapsed = cpuTimeMs(() => {
            tooltip = tooltipFor(firstline);
        });

        expect(tooltip).toContain("macro FOO");
        expect(elapsed).toBeLessThan(500);
    });

    it("reads a long run of slashes followed by a line break in linear time", () => {
        // A lone line break inside the text: every "//" is a possible comment start whose `.*` stops short of the end.
        const firstline = `${"/".repeat(100_000)}\rx`;

        let tooltip = "";
        const elapsed = cpuTimeMs(() => {
            tooltip = tooltipFor(firstline);
        });

        expect(tooltip).toContain("macro FOO");
        expect(elapsed).toBeLessThan(500);
    });
});
