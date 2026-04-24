/**
 * Unit tests for enum-transform.ts
 * Tests transformEnums, expandEnumPropertyAccess, and bundler enum resolution.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    transformEnums,
    expandEnumPropertyAccess,
    extractDeclareEnumNames,
} from "../../transpilers/common/enum-transform";
import { bundle } from "../../transpilers/common/bundle";

describe("transformEnums", () => {
    it("transforms numeric enum with auto-increment", () => {
        const input = `enum Color { Red, Green, Blue }`;
        const { code, enumNames } = transformEnums(input);

        expect(code).toContain("const Color_Red = 0;");
        expect(code).toContain("const Color_Green = 1;");
        expect(code).toContain("const Color_Blue = 2;");
        expect(code).toContain("const Color = {");
        expect(enumNames).toContain("Color");
    });

    it("transforms numeric enum with explicit values", () => {
        const input = `enum Status { OK = 200, NotFound = 404 }`;
        const { code } = transformEnums(input);

        expect(code).toContain("const Status_OK = 200;");
        expect(code).toContain("const Status_NotFound = 404;");
    });

    it("transforms auto-increment after gap", () => {
        const input = `enum E { A = 10, B, C }`;
        const { code } = transformEnums(input);

        expect(code).toContain("const E_A = 10;");
        expect(code).toContain("const E_B = 11;");
        expect(code).toContain("const E_C = 12;");
    });

    it("transforms string enum", () => {
        const input = `enum Dir { Up = "UP", Down = "DOWN" }`;
        const { code } = transformEnums(input);

        expect(code).toContain(`const Dir_Up = "UP";`);
        expect(code).toContain(`const Dir_Down = "DOWN";`);
    });

    it("replaces property access with prefixed name", () => {
        const input = `
enum Color { Red, Green, Blue }
const x = Color.Red;
const y = Color.Blue;
`;
        const { code } = transformEnums(input);

        expect(code).toContain("const x = Color_Red;");
        expect(code).toContain("const y = Color_Blue;");
        // Should not contain Color.Red anymore
        expect(code).not.toContain("Color.Red");
        expect(code).not.toContain("Color.Blue");
    });

    it("handles multiple enums in same file", () => {
        const input = `
enum Color { Red, Green }
enum Size { Small = 1, Large = 2 }
const c = Color.Red;
const s = Size.Large;
`;
        const { code, enumNames } = transformEnums(input);

        expect(code).toContain("const Color_Red = 0;");
        expect(code).toContain("const Size_Small = 1;");
        expect(code).toContain("const c = Color_Red;");
        expect(code).toContain("const s = Size_Large;");
        expect(enumNames).toContain("Color");
        expect(enumNames).toContain("Size");
    });

    it("preserves export on enum", () => {
        const input = `export enum E { A, B }`;
        const { code } = transformEnums(input);

        expect(code).toContain("export const E_A = 0;");
        expect(code).toContain("export const E_B = 1;");
        expect(code).toContain("export const E = {");
    });

    it("skips declare enum", () => {
        const input = `declare enum E { A, B }`;
        const { code, enumNames } = transformEnums(input);

        // Should not transform declare enum
        expect(code).not.toContain("const E_A");
        expect(enumNames.size).toBe(0);
    });

    it("handles empty enum", () => {
        const input = `enum Empty {}`;
        const { code, enumNames } = transformEnums(input);

        expect(code).toContain("const Empty = {} as const;");
        expect(enumNames).toContain("Empty");
    });

    it("leaves non-enum property access unchanged", () => {
        const input = `
enum Color { Red }
const obj = { foo: 1 };
const x = obj.foo;
const y = Color.Red;
`;
        const { code } = transformEnums(input);

        expect(code).toContain("obj.foo");
        expect(code).toContain("const y = Color_Red;");
    });

    it("returns input unchanged when no enums present", () => {
        const input = `const x = 42;\nconst y = "hello";`;
        const { code, enumNames } = transformEnums(input);

        expect(code).toBe(input);
        expect(enumNames.size).toBe(0);
    });

    it("handles const enum same as regular enum", () => {
        const input = `const enum Flags { A = 1, B = 2, C = 4 }`;
        const { code, enumNames } = transformEnums(input);

        expect(code).toContain("const Flags_A = 1;");
        expect(code).toContain("const Flags_B = 2;");
        expect(code).toContain("const Flags_C = 4;");
        expect(enumNames).toContain("Flags");
    });

    it("handles enum member referencing earlier member", () => {
        const input = `enum E { A = 1, B = 2, C = A + B }`;
        const { code } = transformEnums(input);

        expect(code).toContain("const E_A = 1;");
        expect(code).toContain("const E_B = 2;");
        expect(code).toContain("const E_C = 3;");
    });
});

describe("expandEnumPropertyAccess", () => {
    it("only emits vars for referenced enum members", () => {
        const input = `var Color = { Red: 0, Green: 1, Blue: 2 };\nvar x = Color.Red;`;
        const result = expandEnumPropertyAccess(input, new Set(["Color"]));

        // Only Red is referenced
        expect(result).toContain("var Color_Red = 0;");
        expect(result).not.toContain("var Color_Green");
        expect(result).not.toContain("var Color_Blue");
        expect(result).toContain("var x = Color_Red;");
    });

    it("emits multiple referenced members", () => {
        const input = `var E = { A: 0, B: 1, C: 2 };\nvar x = E.A + E.C;`;
        const result = expandEnumPropertyAccess(input, new Set(["E"]));

        expect(result).toContain("var E_A = 0;");
        expect(result).toContain("var E_C = 2;");
        expect(result).not.toContain("var E_B");
        expect(result).toContain("var x = E_A + E_C;");
    });

    it("replaces property access in expressions", () => {
        const input = `var E = { A: 0, B: 1 };\nvar x = E.A + E.B;`;
        const result = expandEnumPropertyAccess(input, new Set(["E"]));

        expect(result).toContain("var x = E_A + E_B;");
    });

    it("leaves non-enum objects unchanged", () => {
        const input = `var obj = { A: 0, B: 1 };\nvar x = obj.A;`;
        const result = expandEnumPropertyAccess(input, new Set(["Color"]));

        expect(result).toContain("var obj = { A: 0, B: 1 }");
        expect(result).toContain("obj.A");
    });

    it("returns input unchanged when enumNames is empty", () => {
        const input = `var x = 42;`;
        const result = expandEnumPropertyAccess(input, new Set());

        expect(result).toBe(input);
    });

    it("removes compat object entirely when no members referenced", () => {
        const input = `var Color = { Red: 0, Green: 1 };\nvar x = 42;`;
        const result = expandEnumPropertyAccess(input, new Set(["Color"]));

        expect(result).not.toContain("Color_Red");
        expect(result).not.toContain("Color_Green");
        expect(result).not.toContain("var Color");
        expect(result).toContain("var x = 42;");
    });
});

describe("expandEnumPropertyAccess — externalized enums", () => {
    it("strips prefix for externalized enum property access", () => {
        // ClassID is a declare enum in a .d.ts file — externalized by esbuild,
        // so no compat object exists in the bundled code. ClassID.ANKHEG → ANKHEG.
        const input = `var x = ClassID.ANKHEG;`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set(["ClassID"]));

        expect(result).toContain("var x = ANKHEG;");
        expect(result).not.toContain("ClassID.ANKHEG");
    });

    it("strips prefix for multiple members of the same externalized enum", () => {
        const input = `var x = ClassID.ANKHEG;\nvar y = ClassID.BASILISK;`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set(["ClassID"]));

        expect(result).toContain("var x = ANKHEG;");
        expect(result).toContain("var y = BASILISK;");
        expect(result).not.toContain("ClassID.");
    });

    it("strips prefix for multiple externalized enums", () => {
        const input = `var x = ClassID.ANKHEG;\nvar y = AnimateID.BASILISK;`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set(["ClassID", "AnimateID"]));

        expect(result).toContain("var x = ANKHEG;");
        expect(result).toContain("var y = BASILISK;");
    });

    it("handles mixed bundled and externalized enums", () => {
        // Direction is a bundled enum (has compat object), ClassID is externalized
        const input = `var Direction = { S: 0, N: 8 };\nvar x = Direction.S;\nvar y = ClassID.ANKHEG;`;
        const result = expandEnumPropertyAccess(input, new Set(["Direction"]), new Set(["ClassID"]));

        // Bundled enum: expanded with underscore prefix and value
        expect(result).toContain("Direction_S");
        // Externalized enum: prefix stripped
        expect(result).toContain("var y = ANKHEG;");
        expect(result).not.toContain("ClassID.ANKHEG");
    });

    it("does not strip prefix for unknown identifiers", () => {
        // SomeObj is neither a bundled nor externalized enum
        const input = `var x = SomeObj.prop;`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set(["ClassID"]));

        expect(result).toContain("SomeObj.prop");
    });

    it("strips prefix in expressions and function arguments", () => {
        const input = `Foo(ClassID.ANKHEG, ClassID.BASILISK)`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set(["ClassID"]));

        expect(result).toContain("Foo(ANKHEG, BASILISK)");
        expect(result).not.toContain("ClassID.");
    });

    it("returns input unchanged when externalEnumNames is empty", () => {
        const input = `var x = ClassID.ANKHEG;`;
        const result = expandEnumPropertyAccess(input, new Set(), new Set());

        expect(result).toBe(input);
    });
});

describe("bundle (esbuild integration)", () => {
    // Temp directory for creating ielib-like package structures
    const tmpDir = path.resolve("tmp/server-test-bundle");

    function writeTmpFile(relPath: string, content: string): string {
        const filePath = path.join(tmpDir, relPath);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function cleanTmpDir() {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    }

    it("resolves enum values from imported packages with extensionless .d.ts imports", async () => {
        // Mimics ielib structure: index.ts re-exports from ./actions (→ actions.d.ts)
        // and ./dir.ids (→ dir.ids.ts with enum), using extensionless imports.
        try {
            // Enum file — should be bundled so values are resolved
            writeTmpFile(
                "pkg/dir.ids.ts",
                `
export enum Direction {
  S = 0, SSW = 1, SW = 2, W = 4, N = 8, E = 12,
}
`,
            );
            // Declaration file — should be externalized (type-only)
            writeTmpFile(
                "pkg/actions.d.ts",
                `
export declare function Attack(target: string): void;
`,
            );
            // Package index with extensionless re-exports (the pattern that caused resolution failures)
            writeTmpFile(
                "pkg/index.ts",
                `
export * from './actions';
export * from './dir.ids';
`,
            );
            // TBAF file that imports and uses enum value
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { Direction, Attack } from "./pkg";
const dir = Direction.S;
const facing = Direction.N;
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            const output = await bundle(tbafPath, source);

            // Enum values should be resolved to their numeric constants
            expect(output).toContain("Direction_S");
            expect(output).toContain("Direction_N");
            // Original property access should be gone
            expect(output).not.toContain("Direction.S");
            expect(output).not.toContain("Direction.N");
        } finally {
            cleanTmpDir();
        }
    });

    it("externalizes .d.ts imports without breaking the build", async () => {
        // Ensures that declaration-only imports don't cause build failures
        try {
            writeTmpFile(
                "lib/actions.d.ts",
                `
export declare function Foo(): void;
`,
            );
            writeTmpFile(
                "lib/index.ts",
                `
export * from './actions';
`,
            );
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { Foo } from "./lib";
Foo();
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            // Should not throw — .d.ts externalization + extensionless resolution should handle this
            const output = await bundle(tbafPath, source);
            expect(output).toContain("Foo");
        } finally {
            cleanTmpDir();
        }
    });

    it("resolves enum values from nested re-exports", async () => {
        // Tests the pattern where root index re-exports from a subdirectory
        // that itself re-exports enum files
        try {
            writeTmpFile(
                "root/sub/color.ids.ts",
                `
export enum Color { Red = 0, Green = 1, Blue = 2 }
`,
            );
            writeTmpFile(
                "root/sub/index.ts",
                `
export * from './color.ids';
`,
            );
            writeTmpFile(
                "root/index.ts",
                `
export * from './sub';
`,
            );
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { Color } from "./root";
const c = Color.Red;
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            const output = await bundle(tbafPath, source);

            expect(output).toContain("Color_Red");
            expect(output).not.toContain("Color.Red");
        } finally {
            cleanTmpDir();
        }
    });

    it("strips prefix for externalized declare enum from .d.ts", async () => {
        // Mimics ielib pattern: classes.d.ts declares enum ClassID,
        // index.ts re-exports it with extensionless import, user code
        // references ClassID.ANKHEG. Since it's in a .d.ts, esbuild
        // externalizes it. Post-processing should strip prefix:
        // ClassID.ANKHEG → ANKHEG.
        try {
            writeTmpFile(
                "lib/classes.d.ts",
                `
export declare enum ClassID {
    ANKHEG = 101,
    BASILISK = 102,
    BEAR = 103,
}
`,
            );
            writeTmpFile(
                "lib/index.ts",
                `
export { ClassID } from './classes';
`,
            );
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { ClassID } from "./lib";
const x = ClassID.ANKHEG;
const y = ClassID.BASILISK;
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            const output = await bundle(tbafPath, source);

            // Externalized enum: prefix stripped, symbolic name preserved
            expect(output).toContain("ANKHEG");
            expect(output).toContain("BASILISK");
            expect(output).not.toContain("ClassID.");
        } finally {
            cleanTmpDir();
        }
    });

    it("strips prefix when .d.ts is imported via shortened .d path", async () => {
        // Mimics ielib's actual pattern: class.ids.d.ts is imported as './class.ids.d'
        // (TypeScript allows omitting .ts). The external-declarations plugin matches
        // the .d suffix, but the resolved path needs .ts appended to read the file.
        try {
            writeTmpFile(
                "lib/class.ids.d.ts",
                `
export declare enum CLASS {
    MAGE = 1,
    FIGHTER = 2,
    THIEF = 4,
    THIEF_ALL = 202,
}
`,
            );
            writeTmpFile(
                "lib/index.ts",
                `
export { CLASS } from './class.ids.d';
`,
            );
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { CLASS } from "./lib";
const x = CLASS.THIEF_ALL;
const y = CLASS.MAGE;
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            const output = await bundle(tbafPath, source);

            // Externalized enum: prefix stripped, symbolic names preserved
            expect(output).toContain("THIEF_ALL");
            expect(output).toContain("MAGE");
            expect(output).not.toContain("CLASS.");
        } finally {
            cleanTmpDir();
        }
    });

    it("handles mixed bundled and externalized enums in imports", async () => {
        // Direction is a regular enum (.ts file, bundled → resolved to values).
        // ClassID is a declare enum (.d.ts file, externalized → prefix stripped).
        try {
            writeTmpFile(
                "lib/dir.ids.ts",
                `
export enum Direction { S = 0, N = 8 }
`,
            );
            writeTmpFile(
                "lib/classes.d.ts",
                `
export declare enum ClassID { ANKHEG = 101 }
`,
            );
            writeTmpFile(
                "lib/index.ts",
                `
export { Direction } from './dir.ids';
export { ClassID } from './classes';
`,
            );
            const tbafPath = writeTmpFile(
                "test.tbaf",
                `
import { Direction, ClassID } from "./lib";
const dir = Direction.S;
const cls = ClassID.ANKHEG;
`,
            );
            const source = fs.readFileSync(tbafPath, "utf-8");
            const output = await bundle(tbafPath, source);

            // Bundled enum: expanded to flat var with value
            expect(output).toContain("Direction_S");
            expect(output).not.toContain("Direction.S");
            // Externalized enum: prefix stripped
            expect(output).toContain("ANKHEG");
            expect(output).not.toContain("ClassID.");
        } finally {
            cleanTmpDir();
        }
    });
});

describe("extractDeclareEnumNames", () => {
    it("extracts declare enum names", () => {
        const text = `
export declare enum ClassID { ANKHEG = 101 }
export declare enum AnimateID { BASILISK = 200 }
`;
        expect(extractDeclareEnumNames(text)).toEqual(["ClassID", "AnimateID"]);
    });

    it("extracts declare const enum names", () => {
        const text = `declare const enum Flags { A = 1, B = 2 }`;
        expect(extractDeclareEnumNames(text)).toEqual(["Flags"]);
    });

    it("returns empty array for regular enums", () => {
        const text = `export enum Direction { S = 0, N = 8 }`;
        expect(extractDeclareEnumNames(text)).toEqual([]);
    });

    it("returns empty array when no enums present", () => {
        const text = `export declare function Foo(): void;`;
        expect(extractDeclareEnumNames(text)).toEqual([]);
    });

    it("handles mixed declare and regular enums", () => {
        const text = `
enum Direction { S = 0 }
declare enum ClassID { ANKHEG = 101 }
enum Color { Red = 0 }
declare enum AnimateID { BASILISK = 200 }
`;
        expect(extractDeclareEnumNames(text)).toEqual(["ClassID", "AnimateID"]);
    });
});
