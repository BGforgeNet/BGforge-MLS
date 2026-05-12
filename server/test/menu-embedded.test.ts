import { describe, expect, it } from "vitest";

import { buildCompiledLuaText, extractLuaSegments, mapLuaLineToSource } from "../src/core/menu-embedded";
import { normalizeUri } from "../src/core/normalized-uri";

describe("menu embedded lua extraction", () => {
    it("extracts raw lua and quoted embedded lua blocks but ignores menu markup", () => {
        const uri = normalizeUri("file:///C:/tmp/UI.MENU");
        const content = [
            "`",
            "a = 1",
            "function helper()",
            "  return 42",
            "end",
            "`",
            "menu {",
            '  enabled "characterViewable"',
            "  action",
            '  "',
            "    currentTab = 1",
            "    updateAttrTable()",
            '  "',
            '  text lua "characters[currentID].name"',
            '  text "LABEL"',
            "}",
        ].join("\n");

        const segments = extractLuaSegments(content, uri);

        expect(segments).toHaveLength(4);
        expect(segments.map((segment) => segment.kind)).toEqual(["statement", "expression", "statement", "expression"]);

        expect(segments[0]?.lua).toContain("function helper()");
        expect(segments[0]?.sourceLineStart).toBe(2);
        expect(segments[0]?.sourceLineEnd).toBe(5);

        expect(segments[1]?.lua).toBe("characterViewable");
        expect(buildCompiledLuaText(segments[1]!).text).toBe("return (characterViewable)");
        expect(mapLuaLineToSource(1, segments[1]!)).toBe(8);

        expect(segments[2]?.lua).toBe("currentTab = 1\n    updateAttrTable()");
        expect(buildCompiledLuaText(segments[2]!).text).toBe("currentTab = 1\n    updateAttrTable()");
        expect(mapLuaLineToSource(1, segments[2]!)).toBe(11);
        expect(mapLuaLineToSource(2, segments[2]!)).toBe(12);

        expect(segments[3]?.lua).toBe("characters[currentID].name");
        expect(buildCompiledLuaText(segments[3]!).text).toBe("return (characters[currentID].name)");

        expect(segments.some((segment) => segment.lua.includes("LABEL"))).toBe(false);
    });
});
