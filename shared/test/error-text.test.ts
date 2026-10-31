import { describe, expect, it } from "vitest";
import { errorText } from "../error-text";

describe("errorText", () => {
    it("reads an Error's own message, without the class name String() puts in front", () => {
        expect(errorText(new TypeError("bad input"))).toBe("bad input");
    });

    it("renders anything else thrown in its string form", () => {
        expect(errorText("plain")).toBe("plain");
        expect(errorText(42)).toBe("42");
        expect(errorText(undefined)).toBe("undefined");
    });
});
