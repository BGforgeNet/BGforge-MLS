/**
 * Unit tests for shared tooltip table rendering (tooltip-table.ts).
 * Tests buildWeiduTable and buildFalloutArgsTable output formats.
 */

import { describe, expect, it } from "vitest";
import { buildWeiduTable, buildFalloutArgsTable, type VarSection } from "../../../shared/tooltip-table";

describe("buildWeiduTable", () => {
    it("returns empty string when all sections are empty", () => {
        const sections: VarSection[] = [
            { label: "INT vars", rows: [] },
            { label: "STR vars", rows: [] },
        ];
        expect(buildWeiduTable(sections)).toBe("");
    });

    it("renders single section with one row", () => {
        const sections: VarSection[] = [
            {
                label: "INT vars",
                rows: [{ type: "int", name: "count", description: "how many" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toBe(
            "| | | | |\n" +
            "|-:|:-|:-|:-|\n" +
            "|**INT**|**vars**|||\n" +
            "|[int](https://ielib.bgforge.net/types#int)|count||&nbsp;&nbsp;how many|"
        );
    });

    it("renders default value", () => {
        const sections: VarSection[] = [
            {
                label: "INT vars",
                rows: [{ type: "int", name: "count", default: "1", description: "how many" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("|[int](https://ielib.bgforge.net/types#int)|count|=&nbsp;1|&nbsp;&nbsp;how many|");
    });

    it("renders required marker", () => {
        const sections: VarSection[] = [
            {
                label: "INT vars",
                rows: [{ type: "int", name: "index", required: true, description: "structure index" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("|[int](https://ielib.bgforge.net/types#int)|index|_required_|&nbsp;&nbsp;structure index|");
    });

    it("renders row without description", () => {
        const sections: VarSection[] = [
            {
                label: "STR vars",
                rows: [{ type: "string", name: "text" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("|[string](https://ielib.bgforge.net/types#string)|text|||");
    });

    it("renders multiple sections", () => {
        const sections: VarSection[] = [
            {
                label: "INT vars",
                rows: [{ type: "int", name: "start", description: "offset" }],
            },
            {
                label: "STR vars",
                rows: [{ type: "string", name: "text", description: "source" }],
            },
            {
                label: "RET vars",
                rows: [{ type: "string", name: "result", description: "the result" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("|**INT**|**vars**|||");
        expect(result).toContain("|**STR**|**vars**|||");
        expect(result).toContain("|**RET**|**vars**|||");
    });

    it("skips empty sections in mixed input", () => {
        const sections: VarSection[] = [
            { label: "INT vars", rows: [] },
            {
                label: "STR vars",
                rows: [{ type: "string", name: "file", description: "path" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).not.toContain("**INT**");
        expect(result).toContain("|**STR**|**vars**|||");
    });

    it("renders unknown type as plain text (no link)", () => {
        const sections: VarSection[] = [
            {
                label: "RET vars",
                rows: [{ type: "any", name: "val" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("|any|val|||");
    });

    it("renders empty type as empty cell", () => {
        const sections: VarSection[] = [
            {
                label: "RET vars",
                rows: [{ type: "", name: "val" }],
            },
        ];
        const result = buildWeiduTable(sections);
        expect(result).toContain("||val|||");
    });
});

describe("buildFalloutArgsTable", () => {
    it("returns empty string when no args have descriptions", () => {
        const args = [
            { name: "a" },
            { name: "b" },
        ];
        expect(buildFalloutArgsTable(args)).toBe("");
    });

    it("returns empty string for empty array", () => {
        expect(buildFalloutArgsTable([])).toBe("");
    });

    it("renders single arg with description", () => {
        const args = [{ name: "who", description: "test123" }];
        const result = buildFalloutArgsTable(args);
        expect(result).toBe(
            "|||\n" +
            "|:-|:-|\n" +
            "|`who`|&nbsp;&nbsp;test123|"
        );
    });

    it("renders multiple args, skipping those without descriptions", () => {
        const args = [
            { name: "a", description: "first" },
            { name: "b" },
            { name: "c", description: "third" },
        ];
        const result = buildFalloutArgsTable(args);
        expect(result).toContain("|`a`|&nbsp;&nbsp;first|");
        expect(result).not.toContain("|`b`|");
        expect(result).toContain("|`c`|&nbsp;&nbsp;third|");
    });
});
