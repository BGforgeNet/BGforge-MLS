/**
 * Tests for shared validation helpers: assertObject, assertArray,
 * requireString, optionalString, optionalBoolean, validateArray.
 */

import { describe, expect, it } from "vitest";
import {
    assertArray,
    assertObject,
    optionalBoolean,
    optionalString,
    requireString,
    validateArray,
} from "../src/validate-helpers.ts";

describe("assertObject", () => {
    it("returns the object when given a valid object", () => {
        const obj = { key: "value" };
        expect(assertObject(obj, "test")).toEqual(obj);
    });

    it("throws on null", () => {
        expect(() => assertObject(null, "test")).toThrow("Expected object in test, got null");
    });

    it("throws on non-object types", () => {
        expect(() => assertObject("string", "test")).toThrow("Expected object in test, got string");
        expect(() => assertObject(42, "test")).toThrow("Expected object in test, got number");
        expect(() => assertObject(undefined, "test")).toThrow("Expected object in test, got undefined");
    });
});

describe("assertArray", () => {
    it("returns the array when given a valid array", () => {
        const arr = [1, 2, 3];
        expect(assertArray(arr, "test")).toEqual(arr);
    });

    it("throws on non-array types", () => {
        expect(() => assertArray("string", "test")).toThrow("Expected array in test, got string");
        expect(() => assertArray({}, "test")).toThrow("Expected array in test, got object");
    });
});

describe("requireString", () => {
    it("returns the string value when present", () => {
        expect(requireString({ name: "hello" }, "name", "test")).toBe("hello");
    });

    it("throws on missing field", () => {
        expect(() => requireString({}, "name", "test")).toThrow("Missing or invalid 'name' (expected string) in test");
    });

    it("throws on non-string field", () => {
        expect(() => requireString({ name: 42 }, "name", "test")).toThrow(
            "Missing or invalid 'name' (expected string) in test",
        );
    });
});

describe("optionalString", () => {
    it("returns the string value when present", () => {
        expect(optionalString({ name: "hello" }, "name", "test")).toBe("hello");
    });

    it("returns undefined when field is missing", () => {
        expect(optionalString({}, "name", "test")).toBeUndefined();
    });

    it("throws on non-string field", () => {
        expect(() => optionalString({ name: 42 }, "name", "test")).toThrow("Invalid 'name' (expected string) in test");
    });
});

describe("optionalBoolean", () => {
    it("returns the boolean value when present", () => {
        expect(optionalBoolean({ flag: true }, "flag", "test")).toBe(true);
    });

    it("returns undefined when field is missing", () => {
        expect(optionalBoolean({}, "flag", "test")).toBeUndefined();
    });

    it("throws on non-boolean field", () => {
        expect(() => optionalBoolean({ flag: "yes" }, "flag", "test")).toThrow(
            "Invalid 'flag' (expected boolean) in test",
        );
    });
});

describe("validateArray", () => {
    const mockValidator = (item: unknown, context: string): string => {
        if (typeof item !== "string") {
            throw new TypeError(`Expected string in ${context}`);
        }
        return item;
    };

    it("validates an array of items", () => {
        const result = validateArray(["a", "b"], mockValidator, "test");
        expect(result).toEqual(["a", "b"]);
    });

    it("throws on non-array input", () => {
        expect(() => validateArray("bad", mockValidator, "test")).toThrow("Expected array in test");
    });

    it("throws with indexed context on item error", () => {
        expect(() => validateArray(["ok", 42], mockValidator, "test")).toThrow("test[1]");
    });
});
