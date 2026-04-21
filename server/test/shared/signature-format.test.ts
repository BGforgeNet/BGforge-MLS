/**
 * Unit tests for shared/signature-format.ts — formatSignature.
 * These tests pin the contract for the module now living in root shared/.
 */

import { describe, expect, it } from "vitest";
import { formatSignature } from "../../../shared/signature-format";

describe("formatSignature", () => {
    it("returns prefix+name when there are no params", () => {
        expect(formatSignature({ name: "foo", prefix: "procedure ", params: [] }))
            .toBe("procedure foo");
    });

    it("returns just name when prefix is empty and no params", () => {
        expect(formatSignature({ name: "FOO", prefix: "", params: [] }))
            .toBe("FOO");
    });

    it("formats typed params as 'type name'", () => {
        expect(formatSignature({
            name: "my_func",
            prefix: "int ",
            params: [
                { name: "a", type: "int" },
                { name: "b", type: "ObjectPtr" },
            ],
        })).toBe("int my_func(int a, ObjectPtr b)");
    });

    it("formats untyped params as bare names", () => {
        expect(formatSignature({
            name: "my_func",
            prefix: "procedure ",
            params: [{ name: "critter" }, { name: "count" }],
        })).toBe("procedure my_func(critter, count)");
    });

    it("appends default value when present", () => {
        expect(formatSignature({
            name: "foo",
            prefix: "void ",
            params: [{ name: "x", type: "int", defaultValue: "0" }],
        })).toBe("void foo(int x = 0)");
    });

    it("appends default value for untyped param", () => {
        expect(formatSignature({
            name: "foo",
            prefix: "procedure ",
            params: [{ name: "x", defaultValue: "0" }],
        })).toBe("procedure foo(x = 0)");
    });

    it("formats macro with 'var' placeholder for untyped params", () => {
        expect(formatSignature({
            name: "PASTE",
            prefix: "macro ",
            params: [{ name: "a", type: "var" }, { name: "b", type: "var" }],
        })).toBe("macro PASTE(var a, var b)");
    });

    it("formats procedure with 'var' placeholder for untyped params", () => {
        expect(formatSignature({
            name: "update",
            prefix: "procedure ",
            params: [
                { name: "critter", type: "var" },
                { name: "count", type: "var", defaultValue: "0" },
            ],
        })).toBe("procedure update(var critter, var count = 0)");
    });

    it("handles single param", () => {
        expect(formatSignature({
            name: "display_msg",
            prefix: "void ",
            params: [{ name: "msg", type: "string" }],
        })).toBe("void display_msg(string msg)");
    });
});
