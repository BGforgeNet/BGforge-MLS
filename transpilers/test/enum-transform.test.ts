/**
 * Enum transformation tests (common/enum-transform.ts): flattening TypeScript
 * enums into prefixed consts + a compat object before esbuild bundling, and
 * expanding/pruning that compat object in post-bundled code.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    collectDeclareEnums,
    expandEnumPropertyAccess,
    extractDeclareEnumNames,
    resolveDtsPath,
    transformEnums,
} from "../common/enum-transform";

describe("transformEnums", () => {
    it("returns source unchanged when no 'enum ' text is present (fast path)", () => {
        const src = "const x = 1;\n";
        const result = transformEnums(src);
        expect(result.code).toBe(src);
        expect(result.enumNames.size).toBe(0);
    });

    it("returns source unchanged when 'enum ' appears in text but no enum declaration parses", () => {
        const src = 'const label = "enum of things";\n';
        const result = transformEnums(src);
        expect(result.code).toBe(src);
        expect(result.enumNames.size).toBe(0);
    });

    it("flattens a numeric enum into prefixed consts and a compat object, and rewrites property access", () => {
        const src = "enum Color { Red, Green }\nfunction f() { return Color.Red; }\n";
        const result = transformEnums(src);
        expect(result.code).toContain("const Color_Red = 0;");
        expect(result.code).toContain("const Color_Green = 1;");
        expect(result.code).toContain("const Color = { Red: 0, Green: 1 } as const;");
        expect(result.code).toContain("return Color_Red;");
        expect(result.enumNames).toEqual(new Set(["Color"]));
    });

    it("flattens a string enum with quoted member values", () => {
        const src = 'enum Status { Active = "active", Done = "done" }\n';
        const result = transformEnums(src);
        expect(result.code).toContain('const Status_Active = "active";');
        expect(result.code).toContain('const Status = { Active: "active", Done: "done" } as const;');
    });

    it("prefixes generated consts with export when the source enum is exported", () => {
        const src = "export enum Color { Red }\n";
        const result = transformEnums(src);
        expect(result.code).toContain("export const Color_Red = 0;");
        expect(result.code).toContain("export const Color = { Red: 0 } as const;");
    });

    it("emits an empty compat object (no member consts) for a zero-member enum", () => {
        const src = "enum Empty {}\n";
        const result = transformEnums(src);
        expect(result.code).toContain("const Empty = {} as const;");
        expect(result.code).not.toContain("Empty_");
    });

    it("skips ambient 'declare enum' declarations, leaving them and their accesses untouched", () => {
        const src = "declare enum Foreign { A, B }\nenum Real { X }\nfunction f() { return Real.X + Foreign.A; }\n";
        const result = transformEnums(src);
        expect(result.code).toContain("declare enum Foreign { A, B }");
        expect(result.code).toContain("const Real_X = 0;");
        expect(result.code).toContain("Foreign.A");
        expect(result.enumNames).toEqual(new Set(["Real"]));
    });
});

describe("expandEnumPropertyAccess", () => {
    it("returns code unchanged when no enum or external names are given (fast path)", () => {
        const code = "var Color = { Red: 0 };\n";
        expect(expandEnumPropertyAccess(code, new Set(), new Set())).toBe(code);
    });

    it("keeps only the referenced members of a compat object, dropping the rest", () => {
        const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return Color.Red; }\n";
        const out = expandEnumPropertyAccess(code, new Set(["Color"]));
        expect(out).toContain("var Color_Red = 0;");
        expect(out).toContain("return Color_Red;");
        expect(out).not.toContain("Green");
    });

    it("removes the compat object entirely when none of its members are referenced", () => {
        const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return 42; }\n";
        const out = expandEnumPropertyAccess(code, new Set(["Color"]));
        expect(out).not.toContain("Color");
    });

    it("strips the enum prefix from externalized enum property accesses", () => {
        const code = "function f() { return ClassID.ANKHEG; }\n";
        const out = expandEnumPropertyAccess(code, new Set(), new Set(["ClassID"]));
        expect(out).toContain("return ANKHEG;");
        expect(out).not.toContain("ClassID");
    });
});

describe("extractDeclareEnumNames", () => {
    it("extracts declare enum and declare const enum names", () => {
        const text = "declare enum Foo {}\ndeclare const enum Bar {}\n";
        expect(extractDeclareEnumNames(text)).toEqual(["Foo", "Bar"]);
    });

    it("returns an empty array when no 'enum ' text is present", () => {
        expect(extractDeclareEnumNames("const x = 1;\n")).toEqual([]);
    });

    it("returns an empty array when 'enum' appears without a declare modifier", () => {
        expect(extractDeclareEnumNames("enum Foo {}\n")).toEqual([]);
    });
});

describe("collectDeclareEnums / resolveDtsPath", () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enum-transform-test-"));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("collectDeclareEnums adds declare enum names from a real file to the target set", () => {
        const filePath = path.join(tmpDir, "external.d.ts");
        fs.writeFileSync(filePath, "declare enum ClassID { ANKHEG, RAT }\n", "utf-8");
        const target = new Set<string>();
        collectDeclareEnums(filePath, target);
        expect(target).toEqual(new Set(["ClassID"]));
    });

    it("collectDeclareEnums silently ignores an unreadable path, leaving the target unchanged", () => {
        const target = new Set<string>(["existing"]);
        collectDeclareEnums(path.join(tmpDir, "does-not-exist.d.ts"), target);
        expect(target).toEqual(new Set(["existing"]));
    });

    it("resolveDtsPath returns the path unchanged when it already exists as given", () => {
        const filePath = path.join(tmpDir, "class.ids.ts");
        fs.writeFileSync(filePath, "export {};\n", "utf-8");
        expect(resolveDtsPath(filePath)).toBe(filePath);
    });

    it("resolveDtsPath appends .ts when only the .ts variant exists on disk", () => {
        const basePath = path.join(tmpDir, "weapon.ids.d");
        fs.writeFileSync(basePath + ".ts", "export {};\n", "utf-8");
        expect(resolveDtsPath(basePath)).toBe(basePath + ".ts");
    });

    it("resolveDtsPath returns the original path unchanged when neither variant exists", () => {
        const basePath = path.join(tmpDir, "missing.d");
        expect(resolveDtsPath(basePath)).toBe(basePath);
    });
});
