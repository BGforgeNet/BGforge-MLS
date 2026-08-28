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

/** The registry expandEnumPropertyAccess reads, shaped as transformEnums reports it. */
function enumRegistry(byName: Record<string, Record<string, number | string>>) {
    return new Map(
        Object.entries(byName).map(([name, members]) => [
            name,
            Object.entries(members).map(([member, value]) => ({ name: member, value: String(value) })),
        ]),
    );
}

describe("transformEnums", () => {
    it("reports each enum's members and values, not only its name", () => {
        // The names alone are not enough to expand a cross-file access later: whoever does that has
        // to know what Red is worth, and the only other place that fact exists is the emitted compat
        // object, which a bundler is free to inline out of existence.
        const result = transformEnums("export enum Color { Red = 0, Green = 1 }\n");

        expect(result.enums.get("Color")).toEqual([
            { name: "Red", value: "0" },
            { name: "Green", value: "1" },
        ]);
    });

    it("returns source unchanged when no 'enum ' text is present (fast path)", () => {
        const src = "const x = 1;\n";
        const result = transformEnums(src);
        expect(result.code).toBe(src);
        expect(result.enums.size).toBe(0);
    });

    it("returns source unchanged when 'enum ' appears in text but no enum declaration parses", () => {
        const src = 'const label = "enum of things";\n';
        const result = transformEnums(src);
        expect(result.code).toBe(src);
        expect(result.enums.size).toBe(0);
    });

    it("flattens a numeric enum into prefixed consts and a compat object, and rewrites property access", () => {
        const src = "enum Color { Red, Green }\nfunction f() { return Color.Red; }\n";
        const result = transformEnums(src);
        expect(result.code).toContain("const Color_Red = 0;");
        expect(result.code).toContain("const Color_Green = 1;");
        expect(result.code).toContain("const Color = { Red: 0, Green: 1 } as const;");
        expect(result.code).toContain("return Color_Red;");
        expect([...result.enums.keys()]).toEqual(["Color"]);
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
        expect([...result.enums.keys()]).toEqual(["Real"]);
    });
});

describe("expandEnumPropertyAccess", () => {
    it("expands an access from the recorded enum data when the bundle carries no compat object", () => {
        // The compat object is a channel through the bundler, not a source of truth: a bundler that
        // inlines a single-use object literal emits no `var Color = {...}` statement at all. The
        // access is the only thing that has to survive, and the values come from the transform.
        const code = "function f() { return Color.Red; }\n";

        const out = expandEnumPropertyAccess(code, new Map([["Color", [{ name: "Red", value: "0" }]]]));

        expect(out).toContain("var Color_Red = 0;");
        expect(out).toContain("return Color_Red;");
    });

    it("returns code unchanged when no enum or external names are given (fast path)", () => {
        const code = "var Color = { Red: 0 };\n";
        expect(expandEnumPropertyAccess(code, new Map(), new Set())).toBe(code);
    });

    it("keeps only the referenced members of a compat object, dropping the rest", () => {
        const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return Color.Red; }\n";
        const out = expandEnumPropertyAccess(code, enumRegistry({ Color: { Red: 0, Green: 1 } }));
        expect(out).toContain("var Color_Red = 0;");
        expect(out).toContain("return Color_Red;");
        expect(out).not.toContain("Green");
    });

    it("removes the compat object entirely when none of its members are referenced", () => {
        const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return 42; }\n";
        const out = expandEnumPropertyAccess(code, enumRegistry({ Color: { Red: 0, Green: 1 } }));
        expect(out).not.toContain("Color");
    });

    it("strips the enum prefix from externalized enum property accesses", () => {
        const code = "function f() { return ClassID.ANKHEG; }\n";
        const out = expandEnumPropertyAccess(code, new Map(), new Set(["ClassID"]));
        expect(out).toContain("return ANKHEG;");
        expect(out).not.toContain("ClassID");
    });

    // A compat object is dropped or rewritten into one line per referenced member, so this pass both
    // removes and adds lines. Every output line still has an origin - a rewritten one belongs to the
    // statement it replaced - and reporting it is what keeps a later position traceable to the source.
    describe("line survival", () => {
        it("drops the line of a compat object nothing references", () => {
            const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return 42; }\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, enumRegistry({ Color: { Red: 0, Green: 1 } }), new Set(), survivors);
            expect(survivors).toEqual([1]);
        });

        it("keeps one line per referenced member, all tracing to the statement they replaced", () => {
            const code = "var Color = {Red: 0, Green: 1};\nfunction f() { return Color.Red + Color.Green; }\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, enumRegistry({ Color: { Red: 0, Green: 1 } }), new Set(), survivors);
            // Two generated `var Color_<member>` lines, both from input line 0, then the function.
            expect(survivors).toEqual([0, 0, 1]);
        });

        it("maps every line to itself when only prefixes are stripped, which stays on one line", () => {
            const code = "function f() { return ClassID.ANKHEG; }\nfunction g() { return 1; }\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, new Map(), new Set(["ClassID"]), survivors);
            expect(survivors).toEqual([0, 1]);
        });

        it("attributes a prepended declaration to the first line", () => {
            const code = "function f() { return 1; }\nfunction g() { return Color.Red; }\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, enumRegistry({ Color: { Red: 0 } }), new Set(), survivors);
            // One `var Color_Red` ahead of the file, then both original lines.
            expect(survivors).toEqual([0, 0, 1]);
        });

        it("keeps the map consistent when one enum is declared in place and another is prepended", () => {
            // A has a compat object to be rewritten in place; B does not, so its declaration is
            // prepended. Both land on line 0, which is the case where the order the two edits are
            // consumed in decides whether the lines after them are counted once or twice.
            const code = "var A = {X: 1};\nfunction f() { return A.X + B.Y; }\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, enumRegistry({ A: { X: 1 }, B: { Y: 2 } }), new Set(), survivors);
            expect(survivors).toEqual([0, 0, 1]);
        });

        it("maps every line to itself on the fast path, where nothing is rewritten", () => {
            const code = "var Color = { Red: 0 };\nvar x = 1;\n";
            const survivors: number[] = [];
            expandEnumPropertyAccess(code, new Map(), new Set(), survivors);
            expect(survivors).toEqual([0, 1]);
        });
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
