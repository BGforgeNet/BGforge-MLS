/**
 * Tests for ie-update runtime validators.
 * Covers validateActionParam, validateActionItem, validateIESDPGame,
 * validateOffsetItem, validateItemTypeRaw, validateTypeEntry, and validateFuncData.
 */

import { describe, expect, it } from "vitest";
import {
    validateActionItem,
    validateActionParam,
    validateFuncData,
    validateIESDPGame,
    validateItemTypeRaw,
    validateOffsetItem,
    validateTypeEntry,
} from "../src/ie/validate.ts";

// -- validateActionParam --

describe("validateActionParam", () => {
    it("returns a valid ActionParam", () => {
        const result = validateActionParam({ type: "i", name: "Target", ids: "OBJECT" }, "test");
        expect(result).toEqual({ type: "i", name: "Target", ids: "OBJECT" });
    });

    it("returns a valid ActionParam without ids", () => {
        const result = validateActionParam({ type: "s", name: "ResRef" }, "test");
        expect(result).toEqual({ type: "s", name: "ResRef", ids: undefined });
    });

    it("throws when type is missing", () => {
        expect(() => validateActionParam({ name: "Target" }, "ctx")).toThrow("type");
    });

    it("throws when name is missing", () => {
        expect(() => validateActionParam({ type: "i" }, "ctx")).toThrow("name");
    });

    it("throws when input is not an object", () => {
        expect(() => validateActionParam("bad", "ctx")).toThrow();
    });
});

// -- validateActionItem --

describe("validateActionItem", () => {
    it("returns a minimal ActionItem", () => {
        const result = validateActionItem({ n: 1, name: "Wait", bg2: 1 }, "test");
        expect(result.n).toBe(1);
        expect(result.name).toBe("Wait");
        expect(result.bg2).toBe(1);
    });

    it("returns an ActionItem with numeric alias", () => {
        const result = validateActionItem({ n: 2, name: "Wait2", alias: 1, bg2: 1 }, "test");
        expect(result.alias).toBe(1);
    });

    it("returns an ActionItem with boolean alias", () => {
        const result = validateActionItem({ n: 3, name: "Wait3", alias: true, bg2: 1 }, "test");
        expect(result.alias).toBe(true);
    });

    it("returns an ActionItem with params", () => {
        const raw = {
            n: 10,
            name: "CreateCreature",
            bg2: 1,
            params: [{ type: "s", name: "Creature" }],
        };
        const result = validateActionItem(raw, "test");
        expect(result.params).toHaveLength(1);
        expect(result.params![0]!.name).toBe("Creature");
    });

    it("returns an ActionItem with optional fields", () => {
        const result = validateActionItem(
            { n: 5, name: "X", bgee: 2, desc: "Some desc", no_result: true, unknown: true },
            "test",
        );
        expect(result.bgee).toBe(2);
        expect(result.desc).toBe("Some desc");
        expect(result.no_result).toBe(true);
        expect(result.unknown).toBe(true);
    });

    it("throws for invalid alias type", () => {
        expect(() => validateActionItem({ n: 1, name: "X", alias: "bad" }, "ctx")).toThrow("alias");
    });

    it("throws when n is missing", () => {
        expect(() => validateActionItem({ name: "X" }, "ctx")).toThrow("n");
    });

    it("throws when name is missing", () => {
        expect(() => validateActionItem({ n: 1 }, "ctx")).toThrow("name");
    });

    it("throws when input is not an object", () => {
        expect(() => validateActionItem(42, "ctx")).toThrow();
    });

    it("throws when params entry is invalid", () => {
        expect(() => validateActionItem({ n: 1, name: "X", params: [{ type: "i" }] }, "ctx")).toThrow("name");
    });
});

// -- validateIESDPGame --

describe("validateIESDPGame", () => {
    it("returns a valid IESDPGame", () => {
        const raw = { name: "bg2", ids: "/files/ids/bg2", "2da": "/files/2da/bg2", actions: "/scripting/actions/bg2" };
        const result = validateIESDPGame(raw, "test");
        expect(result.name).toBe("bg2");
        expect(result.ids).toBe("/files/ids/bg2");
        expect(result["2da"]).toBe("/files/2da/bg2");
        expect(result.actions).toBe("/scripting/actions/bg2");
    });

    it("throws when name is missing", () => {
        expect(() => validateIESDPGame({ ids: "/x", "2da": "/y", actions: "/z" }, "ctx")).toThrow("name");
    });

    it("throws when ids is missing", () => {
        expect(() => validateIESDPGame({ name: "bg2", "2da": "/y", actions: "/z" }, "ctx")).toThrow("ids");
    });

    it("throws when input is not an object", () => {
        expect(() => validateIESDPGame(null, "ctx")).toThrow();
    });
});

// -- validateOffsetItem --

describe("validateOffsetItem", () => {
    it("returns a minimal OffsetItem", () => {
        const raw = { type: "char", desc: "Name" };
        const result = validateOffsetItem(raw, "test");
        expect(result.type).toBe("char");
        expect(result.desc).toBe("Name");
    });

    it("returns an OffsetItem with numeric optional fields", () => {
        const raw = { type: "dword", desc: "Offset", offset: 4, length: 4, mult: 2, id: "SPELL" };
        const result = validateOffsetItem(raw, "test");
        expect(result.offset).toBe(4);
        expect(result.length).toBe(4);
        expect(result.mult).toBe(2);
        expect(result.id).toBe("SPELL");
    });

    it("returns an OffsetItem with numeric unused and unknown", () => {
        const raw = { type: "byte", desc: "X", unused: 1, unknown: 1 };
        const result = validateOffsetItem(raw, "test");
        expect(result.unused).toBe(1);
        expect(result.unknown).toBe(1);
    });

    it("returns an OffsetItem with boolean unused and unknown", () => {
        const raw = { type: "byte", desc: "X", unused: true, unknown: false };
        const result = validateOffsetItem(raw, "test");
        expect(result.unused).toBe(true);
        expect(result.unknown).toBe(false);
    });

    it("throws when type is missing", () => {
        expect(() => validateOffsetItem({ desc: "X" }, "ctx")).toThrow("type");
    });

    it("throws when desc is missing", () => {
        expect(() => validateOffsetItem({ type: "byte" }, "ctx")).toThrow("desc");
    });

    it("throws when offset is not a number", () => {
        expect(() => validateOffsetItem({ type: "byte", desc: "X", offset: "bad" }, "ctx")).toThrow("offset");
    });

    it("throws when unused is invalid type", () => {
        expect(() => validateOffsetItem({ type: "byte", desc: "X", unused: "bad" }, "ctx")).toThrow("unused");
    });
});

// -- validateItemTypeRaw --

describe("validateItemTypeRaw", () => {
    it("returns a valid ItemTypeRaw", () => {
        const raw = { type: "Weapon", code: "0x03", id: "WEAPTYPE" };
        const result = validateItemTypeRaw(raw, "test");
        expect(result.type).toBe("Weapon");
        expect(result.code).toBe("0x03");
        expect(result.id).toBe("WEAPTYPE");
    });

    it("returns a valid ItemTypeRaw without id", () => {
        const raw = { type: "Armor", code: "0x02" };
        const result = validateItemTypeRaw(raw, "test");
        expect(result.id).toBeUndefined();
    });

    it("throws when type is missing", () => {
        expect(() => validateItemTypeRaw({ code: "0x00" }, "ctx")).toThrow("type");
    });

    it("throws when code is missing", () => {
        expect(() => validateItemTypeRaw({ type: "Misc" }, "ctx")).toThrow("code");
    });
});

// -- validateTypeEntry --

describe("validateTypeEntry", () => {
    it("returns a valid TypeEntry", () => {
        const result = validateTypeEntry({ name: "int" }, "test");
        expect(result.name).toBe("int");
    });

    it("throws when name is missing", () => {
        expect(() => validateTypeEntry({}, "ctx")).toThrow("name");
    });

    it("throws when input is not an object", () => {
        expect(() => validateTypeEntry("string", "ctx")).toThrow();
    });
});

// -- validateFuncData --

describe("validateFuncData", () => {
    it("returns a minimal FuncData", () => {
        const raw = { name: "myFunc", type: "void", desc: "Does something" };
        const result = validateFuncData(raw, "test");
        expect(result.name).toBe("myFunc");
        expect(result.type).toBe("void");
        expect(result.desc).toBe("Does something");
        expect(result.int_params).toBeUndefined();
        expect(result.string_params).toBeUndefined();
        expect(result.return).toBeUndefined();
        expect(result.defaults).toBeUndefined();
    });

    it("returns FuncData with int_params", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            int_params: [{ name: "a", desc: "first", type: "int", required: 1 }],
        };
        const result = validateFuncData(raw, "test");
        expect(result.int_params).toHaveLength(1);
        expect(result.int_params![0]!.name).toBe("a");
        expect(result.int_params![0]!.required).toBe(1);
    });

    it("returns FuncData with string_params", () => {
        const raw = {
            name: "f",
            type: "str",
            desc: "x",
            string_params: [{ name: "path", desc: "file path", type: "string" }],
        };
        const result = validateFuncData(raw, "test");
        expect(result.string_params).toHaveLength(1);
        expect(result.string_params![0]!.type).toBe("string");
    });

    it("returns FuncData with return values", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            return: [{ name: "result", desc: "output", type: "int" }],
        };
        const result = validateFuncData(raw, "test");
        expect(result.return).toHaveLength(1);
        expect(result.return![0]!.name).toBe("result");
    });

    it("returns FuncData with defaults as string map", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            defaults: { mode: "normal", flag: "0" },
        };
        const result = validateFuncData(raw, "test");
        expect(result.defaults).toEqual({ mode: "normal", flag: "0" });
    });

    it("returns FuncData with string default value in param", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            int_params: [{ name: "x", desc: "d", type: "int", default: "0" }],
        };
        const result = validateFuncData(raw, "test");
        expect(result.int_params![0]!.default).toBe("0");
    });

    it("returns FuncData with numeric default value in param", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            int_params: [{ name: "x", desc: "d", type: "int", default: 42 }],
        };
        const result = validateFuncData(raw, "test");
        expect(result.int_params![0]!.default).toBe(42);
    });

    it("throws when param default is wrong type", () => {
        const raw = {
            name: "f",
            type: "int",
            desc: "x",
            int_params: [{ name: "x", desc: "d", type: "int", default: true }],
        };
        expect(() => validateFuncData(raw, "ctx")).toThrow("default");
    });

    it("throws when defaults map has non-string value", () => {
        const raw = { name: "f", type: "int", desc: "x", defaults: { a: 42 } };
        expect(() => validateFuncData(raw, "ctx")).toThrow("default");
    });

    it("throws when name is missing", () => {
        expect(() => validateFuncData({ type: "int", desc: "x" }, "ctx")).toThrow("name");
    });

    it("throws when type is missing", () => {
        expect(() => validateFuncData({ name: "f", desc: "x" }, "ctx")).toThrow("type");
    });

    it("throws when desc is missing", () => {
        expect(() => validateFuncData({ name: "f", type: "int" }, "ctx")).toThrow("desc");
    });

    it("throws when int_params is not an array", () => {
        expect(() => validateFuncData({ name: "f", type: "int", desc: "x", int_params: "bad" }, "ctx")).toThrow();
    });
});
