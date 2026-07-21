/**
 * isEnumConstant tests (tssl/src/emit.ts): identifies whether a #define name
 * was generated from an enum member (EnumName_Member) versus a plain constant.
 */
import { describe, expect, it } from "vitest";
import { isEnumConstant } from "../tssl/src/emit";

describe("isEnumConstant", () => {
    it("matches a simple EnumName_Member constant", () => {
        expect(isEnumConstant("Color_Red", new Set(["Color"]))).toBe(true);
    });

    it("matches an enum name that itself contains an underscore", () => {
        expect(isEnumConstant("DAMAGE_TYPE_Fire", new Set(["DAMAGE_TYPE"]))).toBe(true);
    });

    it("returns false when the prefix isn't a known enum name", () => {
        expect(isEnumConstant("Foo_Bar", new Set(["Color"]))).toBe(false);
    });

    it("returns false for a name with no underscore", () => {
        expect(isEnumConstant("PlainConst", new Set(["Color"]))).toBe(false);
    });

    it("returns false when enumNames is empty", () => {
        expect(isEnumConstant("Color_Red", new Set())).toBe(false);
    });
});
