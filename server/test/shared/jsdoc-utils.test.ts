/**
 * Unit tests for Fallout SSL JSDoc-to-markdown formatting (jsdoc-format.ts).
 * Covers headerless table args and Returns line.
 */

import { describe, expect, it } from "vitest";
import { jsdocToMarkdown } from "../../src/fallout-ssl/jsdoc-format";
import { parse, type JSdoc } from "../../src/shared/jsdoc";

describe("jsdocToMarkdown", () => {
    describe("args formatting", () => {
        it("formats single arg as table row", () => {
            const jsd: JSdoc = {
                args: [{ name: "who", type: "float", description: "test123" }],
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).toContain("|`who`|&nbsp;&nbsp;test123|");
        });

        it("formats args as right-aligned name table", () => {
            const jsd: JSdoc = {
                args: [
                    { name: "who", type: "float", description: "test123" },
                    { name: "alive", type: "int", description: "test2" },
                ],
            };
            const md = jsdocToMarkdown(jsd);

            expect(md).toContain("|`who`|&nbsp;&nbsp;test123|");
            expect(md).toContain("|`alive`|&nbsp;&nbsp;test2|");
            // Right-aligned names, left-aligned descriptions
            expect(md).toContain("|:-|:-|");
        });

        it("excludes args without descriptions", () => {
            const jsd: JSdoc = {
                args: [{ name: "x", type: "int" }],
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).not.toContain("x");
        });

        it("only lists args that have descriptions", () => {
            const jsd: JSdoc = {
                args: [
                    { name: "who", type: "float", description: "test123" },
                    { name: "alive", type: "int" },
                ],
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).toContain("who");
            expect(md).not.toContain("alive");
        });

        it("formats arg name in inline code", () => {
            const jsd: JSdoc = {
                args: [{ name: "count", type: "int", description: "number of items" }],
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).toContain("|`count`|&nbsp;&nbsp;number of items|");
        });
    });

    describe("Returns line", () => {
        it("hides Returns when ret has type only (no description)", () => {
            const jsd: JSdoc = {
                args: [],
                ret: { type: "int" },
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).not.toContain("Returns");
        });

        it("does not include type in Returns line", () => {
            const jsd: JSdoc = {
                args: [],
                ret: { type: "float", description: "the result" },
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).toContain("**Returns** the result");
            expect(md).not.toContain("`float`");
        });

        it("shows description after **Returns** when present", () => {
            const jsd: JSdoc = {
                args: [],
                ret: { type: "int", description: "the result value" },
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).toContain("**Returns** the result value");
        });

        it("does not show Returns when ret is absent", () => {
            const jsd: JSdoc = {
                args: [],
            };
            const md = jsdocToMarkdown(jsd);
            expect(md).not.toContain("Returns");
        });
    });

    describe("end-to-end: parse then format", () => {
        it("formats args and returns from real JSDoc comment", () => {
            const input = `/**
 * qweqweqwe
 * @arg {float} who test123
 * @arg {int} alive test2
 * @ret {float} bzz
 */`;
            const jsd = parse(input);
            const md = jsdocToMarkdown(jsd);

            expect(md).toContain("qweqweqwe");
            expect(md).toContain("|`who`|&nbsp;&nbsp;test123|");
            expect(md).toContain("|`alive`|&nbsp;&nbsp;test2|");
            expect(md).toContain("**Returns** bzz");
        });

        it("hides Returns when @ret has no description", () => {
            const input = `/**
 * desc
 * @arg {int} x the value
 * @ret {int}
 */`;
            const jsd = parse(input);
            const md = jsdocToMarkdown(jsd);

            expect(md).toContain("|`x`|&nbsp;&nbsp;the value|");
            expect(md).not.toContain("Returns");
        });
    });
});
