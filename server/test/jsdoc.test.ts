/**
 * Unit tests for JSDoc parser.
 */

import { describe, expect, it } from "vitest";
import * as jsdoc from "../src/shared/jsdoc";

describe("jsdoc.parse", () => {
    describe("@param parsing", () => {
        it("parses @param with type and name", () => {
            const input = `/**
 * @param {int} count
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({ name: "count", type: "int" });
        });

        it("parses @param with type, name, and description", () => {
            const input = `/**
 * @param {string} name The name to use
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "name",
                type: "string",
                description: "The name to use",
            });
        });

        it("parses @param with description using dash separator", () => {
            const input = `/**
 * @param {bool} enabled - Whether feature is enabled
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "enabled",
                type: "bool",
                description: "Whether feature is enabled",
            });
        });

        it("parses @param with [name=default] syntax but ignores default", () => {
            // The [name=default] syntax is parsed for compatibility but default is ignored
            // (defaults come from AST, not JSDoc)
            const input = `/**
 * @param {int} [count=0] Number of items
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "count",
                type: "int",
                description: "Number of items",
            });
        });

        it("parses @arg as alias for @param", () => {
            const input = `/**
 * @arg {string} value
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({ name: "value", type: "string" });
        });

        it("parses multiple @param tags", () => {
            const input = `/**
 * @param {int} count
 * @param {string} name
 * @param {bool} enabled
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(3);
            expect(result.args[0].name).toBe("count");
            expect(result.args[1].name).toBe("name");
            expect(result.args[2].name).toBe("enabled");
        });

        it("parses @param with ! suffix as required", () => {
            const input = `/**
 * @param {int} count! Required parameter
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "count",
                type: "int",
                required: true,
                description: "Required parameter",
            });
        });

        it("parses @param without braces when type is known", () => {
            const input = `/**
 * @param int count Number of items
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "count",
                type: "int",
                description: "Number of items",
            });
        });

        it("parses @param without braces with required marker", () => {
            const input = `/**
 * @param string name!
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(1);
            expect(result.args[0]).toEqual({
                name: "name",
                type: "string",
                required: true,
            });
        });

        it("parses @param without braces for all known types", () => {
            const input = `/**
 * @param array items
 * @param bool enabled
 * @param float ratio
 * @param ids creature_type
 * @param resref dialog_file
 * @param filename save_path
 * @param list values
 * @param map lookup
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(8);
            expect(result.args[0]).toEqual({ name: "items", type: "array" });
            expect(result.args[1]).toEqual({ name: "enabled", type: "bool" });
            expect(result.args[2]).toEqual({ name: "ratio", type: "float" });
            expect(result.args[3]).toEqual({ name: "creature_type", type: "ids" });
            expect(result.args[4]).toEqual({ name: "dialog_file", type: "resref" });
            expect(result.args[5]).toEqual({ name: "save_path", type: "filename" });
            expect(result.args[6]).toEqual({ name: "values", type: "list" });
            expect(result.args[7]).toEqual({ name: "lookup", type: "map" });
        });

        it("does not parse @param without braces if type is unknown", () => {
            const input = `/**
 * @param unknown_type name
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(0);
        });

        it("parses mixed required and optional params", () => {
            const input = `/**
 * @param {int} count! Required count
 * @param {string} name Optional name
 * @param {bool} enabled! Required flag
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toHaveLength(3);
            expect(result.args[0]).toEqual({
                name: "count",
                type: "int",
                required: true,
                description: "Required count",
            });
            expect(result.args[1]).toEqual({
                name: "name",
                type: "string",
                description: "Optional name",
            });
            expect(result.args[2]).toEqual({
                name: "enabled",
                type: "bool",
                required: true,
                description: "Required flag",
            });
        });
    });

    describe("@return parsing", () => {
        it("parses unnamed @return with type", () => {
            const input = `/**
 * @return {int}
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "int" });
        });

        it("parses @returns as alias", () => {
            const input = `/**
 * @returns {string}
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "string" });
        });

        it("parses @ret as alias", () => {
            const input = `/**
 * @ret {bool}
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "bool" });
        });

        it("parses unnamed @return with type and description", () => {
            const input = `/**
 * @ret {float} bzz
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "float", description: "bzz" });
        });

        it("parses unnamed @return with type and dash-separated description", () => {
            const input = `/**
 * @return {int} - the count
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "int", description: "the count" });
        });

        it("parses unnamed @ret without braces when type is known", () => {
            const input = `/**
 * @ret int
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "int" });
        });

        it("parses unnamed @ret without braces with description", () => {
            const input = `/**
 * @ret bool True if critter is wearing armor
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({
                type: "bool",
                description: "True if critter is wearing armor",
            });
        });

        it("does not parse @ret without braces if type is unknown", () => {
            const input = `/**
 * @ret unknown_type
 */`;
            const result = jsdoc.parse(input);
            expect(result.ret).toBeUndefined();
        });
    });

    describe("@deprecated parsing", () => {
        it("parses @deprecated without message", () => {
            const input = `/**
 * @deprecated
 */`;
            const result = jsdoc.parse(input);
            expect(result.deprecated).toBe(true);
        });

        it("parses @deprecated with message", () => {
            const input = `/**
 * @deprecated Use new_func instead
 */`;
            const result = jsdoc.parse(input);
            expect(result.deprecated).toBe("Use new_func instead");
        });
    });

    describe("description parsing", () => {
        it("parses single-line description", () => {
            const input = `/**
 * Does something useful.
 */`;
            const result = jsdoc.parse(input);
            expect(result.desc).toBe("Does something useful.");
        });

        it("parses multi-line description", () => {
            const input = `/**
 * Does something useful.
 * With multiple lines.
 */`;
            const result = jsdoc.parse(input);
            expect(result.desc).toBe("Does something useful.\nWith multiple lines.");
        });

        it("excludes @tag lines from description", () => {
            const input = `/**
 * Main description.
 * @param {int} count
 */`;
            const result = jsdoc.parse(input);
            expect(result.desc).toBe("Main description.");
        });
    });

    describe("@type parsing", () => {
        it("parses @type with braces", () => {
            const input = `/**
 * @type {int}
 */`;
            const result = jsdoc.parse(input);
            expect(result.type).toBe("int");
        });

        it("parses @type without braces", () => {
            const input = `/**
 * @type string
 */`;
            const result = jsdoc.parse(input);
            expect(result.type).toBe("string");
        });

        it("parses @type with description", () => {
            const input = `/**
 * Counter variable.
 * @type int
 */`;
            const result = jsdoc.parse(input);
            expect(result.type).toBe("int");
            expect(result.desc).toBe("Counter variable.");
        });

        it("parses single-line JSDoc with @type and description", () => {
            const result = jsdoc.parse(`/** @type int Berserker column in 2da */`);
            expect(result.type).toBe("int");
            expect(result.desc).toBe("Berserker column in 2da");
        });

        it("parses single-line JSDoc with description only", () => {
            const result = jsdoc.parse(`/** Some variable description */`);
            expect(result.type).toBeUndefined();
            expect(result.desc).toBe("Some variable description");
        });

        it("parses single-line JSDoc with @type only", () => {
            const result = jsdoc.parse(`/** @type string */`);
            expect(result.type).toBe("string");
            expect(result.desc).toBeUndefined();
        });

        it("parses @type with offset compound form", () => {
            const result = jsdoc.parse(`/** @type {resref offset} */`);
            expect(result.type).toBe("resref offset");
        });

        it("parses @type with offset compound form and description", () => {
            const result = jsdoc.parse(`/**\n * @type {resref offset} - ground icon\n */`);
            expect(result.type).toBe("resref offset");
            expect(result.desc).toBe("ground icon");
        });

        it("parses @type with array offset compound form", () => {
            const result = jsdoc.parse(`/** @type {byte array offset} */`);
            expect(result.type).toBe("byte array offset");
        });

        it("parses @type {char array offset}", () => {
            const result = jsdoc.parse(`/** @type {char array offset} */`);
            expect(result.type).toBe("char array offset");
        });

        it("rejects invalid compound type", () => {
            const result = jsdoc.parse(`/** @type {resref foo} */`);
            expect(result.type).toBeUndefined();
        });

        it("parses single-line JSDoc with @deprecated", () => {
            const result = jsdoc.parse(`/** @deprecated Use new_var instead */`);
            expect(result.deprecated).toBe("Use new_var instead");
        });
    });

    describe("combined parsing", () => {
        it("parses complete JSDoc comment", () => {
            const input = `/**
 * Calculates the sum of values.
 * @param {int} a First value
 * @param {int} b Second value
 * @return {int}
 * @deprecated Use sum_v2 instead
 */`;
            const result = jsdoc.parse(input);
            expect(result.desc).toBe("Calculates the sum of values.");
            expect(result.args).toHaveLength(2);
            expect(result.args[0]).toEqual({ name: "a", type: "int", description: "First value" });
            expect(result.args[1]).toEqual({ name: "b", type: "int", description: "Second value" });
            expect(result.ret).toEqual({ type: "int" });
            expect(result.deprecated).toBe("Use sum_v2 instead");
        });

        it("returns empty args array when no params", () => {
            const input = `/**
 * Simple function.
 */`;
            const result = jsdoc.parse(input);
            expect(result.args).toEqual([]);
        });
    });

    describe("named return mode", () => {
        it("parses type-before-name braced: @ret {array} spells - desc", () => {
            const input = `/**
 * @ret {array} spells - A hand-picked list
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "spells",
                type: "array",
                description: "A hand-picked list",
            });
            expect(result.ret).toBeUndefined();
        });

        it("parses type-before-name braced without description: @ret {array} spells", () => {
            const input = `/**
 * @ret {array} spells
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "spells",
                type: "array",
            });
            expect(result.ret).toBeUndefined();
        });

        it("parses type-before-name braced: @ret {int} count - number of items", () => {
            const input = `/**
 * @ret {int} count - number of items
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "count",
                type: "int",
                description: "number of items",
            });
            expect(result.ret).toBeUndefined();
        });

        it("parses type-before-name braced with ambiguous name: @ret {bool} True if ...", () => {
            const input = `/**
 * @ret {bool} True if critter is wearing armor
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "True",
                type: "bool",
                description: "if critter is wearing armor",
            });
            expect(result.ret).toBeUndefined();
        });

        it("ignores name-before-type braced: @ret spells {array} desc", () => {
            const input = `/**
 * @ret spells {array} A hand-picked list
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            // Name-before-type is not supported in named mode — only @ret {type} name
            expect(result.rets).toBeUndefined();
            expect(result.ret).toBeUndefined();
        });

        it("ignores name-before-type braceless: @ret count int - desc", () => {
            const input = `/**
 * @ret count int - number of items
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            // Name-before-type is not supported in named mode
            expect(result.rets).toBeUndefined();
            expect(result.ret).toBeUndefined();
        });

        it("parses braceless type-before-name: @ret array spells A hand-picked list", () => {
            const input = `/**
 * @ret array spells A hand-picked list
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "spells",
                type: "array",
                description: "A hand-picked list",
            });
            expect(result.ret).toBeUndefined();
        });

        it("ignores braceless @ret with unknown type in named mode", () => {
            const input = `/**
 * @ret foo bar baz
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toBeUndefined();
            expect(result.ret).toBeUndefined();
        });

        it("never sets ret in named mode (only rets)", () => {
            const input = `/**
 * @ret {int}
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            // In named mode, bare @ret {type} with no name is not a valid named return
            expect(result.ret).toBeUndefined();
        });

        it("works with @return alias in named mode", () => {
            const input = `/**
 * @return {int} count - number of items
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0]).toEqual({
                name: "count",
                type: "int",
                description: "number of items",
            });
            expect(result.ret).toBeUndefined();
        });

        it("ignores bare @ret {type} alongside named @ret in named mode", () => {
            const input = `/**
 * @ret {int}
 * @ret {int} count - number of items
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.ret).toBeUndefined();
            expect(result.rets).toHaveLength(1);
            expect(result.rets![0].name).toBe("count");
        });

        it("parses multiple named returns in named mode", () => {
            const input = `/**
 * @ret {int} x - x coordinate
 * @ret {int} y - y coordinate
 */`;
            const result = jsdoc.parse(input, { returnMode: "named" });
            expect(result.rets).toHaveLength(2);
            expect(result.rets![0]).toEqual({
                name: "x",
                type: "int",
                description: "x coordinate",
            });
            expect(result.rets![1]).toEqual({
                name: "y",
                type: "int",
                description: "y coordinate",
            });
            expect(result.ret).toBeUndefined();
        });
    });

    describe("buildParamInfoMap()", () => {
        it("returns empty map when jsdoc is undefined", () => {
            const map = jsdoc.buildParamInfoMap(undefined);
            expect(map.size).toBe(0);
        });

        it("returns empty map when jsdoc has no args", () => {
            const map = jsdoc.buildParamInfoMap({ desc: "no args" });
            expect(map.size).toBe(0);
        });

        it("maps args with description only", () => {
            const map = jsdoc.buildParamInfoMap({
                args: [{ name: "count", type: "int", description: "Item count" }],
            });
            expect(map.get("count")).toEqual({ description: "Item count" });
        });

        it("maps args with required flag only", () => {
            const map = jsdoc.buildParamInfoMap({
                args: [{ name: "name", type: "string", required: true }],
            });
            expect(map.get("name")).toEqual({ required: true });
        });

        it("maps args with both description and required", () => {
            const map = jsdoc.buildParamInfoMap({
                args: [{ name: "id", type: "int", description: "The id", required: true }],
            });
            expect(map.get("id")).toEqual({ description: "The id", required: true });
        });

        it("skips args with neither description nor required", () => {
            // arg has no description and no required flag → not added to map
            const map = jsdoc.buildParamInfoMap({
                args: [{ name: "unused", type: "int" }],
            });
            expect(map.has("unused")).toBe(false);
        });
    });

    describe("unnamed return mode (default)", () => {
        it("existing unnamed @return tests are unaffected by returnMode option", () => {
            const input = `/**
 * @ret {float} bzz
 */`;
            // Default (no options) - same as unnamed
            const result = jsdoc.parse(input);
            expect(result.ret).toEqual({ type: "float", description: "bzz" });
        });

        it("explicit unnamed mode behaves same as default", () => {
            const input = `/**
 * @ret {float} bzz
 */`;
            const result = jsdoc.parse(input, { returnMode: "unnamed" });
            expect(result.ret).toEqual({ type: "float", description: "bzz" });
        });
    });
});
