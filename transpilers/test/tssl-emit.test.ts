/**
 * Enum emission through the public transpile: which members become #defines, and how a member access
 * prints. Members are identified by their declarations rather than by name pattern, so an unused member
 * tree-shakes away while an unrelated constant that merely looks like one (Foo_Bar) is untouched.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBatchState, transpile } from "../tssl/src/index";

// One ts-morph project for the whole file: creating one per case re-parses the TypeScript default
// library every time, which is most of a small fixture's transpile cost.
const batch = createBatchState();

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-emit-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let fileSeq = 0;
async function emit(src: string, extras: Record<string, string> = {}): Promise<string> {
    const dir = path.join(tmpDir, `case${fileSeq++}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(extras)) {
        fs.writeFileSync(path.join(dir, name), body, "utf-8");
    }
    const filePath = path.join(dir, "main.tssl");
    fs.writeFileSync(filePath, src, "utf-8");
    return transpile(filePath, src, batch);
}

describe("enum emission", () => {
    it("emits a define for a referenced member and tree-shakes the rest", async () => {
        const out = await emit(
            `enum Color {\n    Red = 1,\n    Green = 2,\n}\nfunction start() {\n    display_msg(Color.Red);\n}\n`,
        );
        expect(out).toContain("#define Color_Red 1");
        expect(out).not.toContain("Color_Green");
        expect(out).toContain("display_msg(Color_Red);");
    });

    it("auto-increments member values the way TypeScript does", async () => {
        const out = await emit(
            `enum Mode {\n    A,\n    B,\n    C,\n}\nfunction start() {\n    display_msg(Mode.C);\n}\n`,
        );
        expect(out).toContain("#define Mode_C 2");
    });

    it("emits an imported enum's member under the importing script", async () => {
        const out = await emit(
            `import { Damage } from "./shared-enums";\nfunction start() {\n    display_msg(Damage.Fire);\n}\n`,
            { "shared-enums.ts": "export enum Damage {\n    Normal = 0,\n    Fire = 3,\n}\n" },
        );
        expect(out).toContain("#define Damage_Fire 3");
        expect(out).not.toContain("Damage_Normal");
        expect(out).toContain("display_msg(Damage_Fire);");
    });

    it("prints a declare-enum member bare, leaving its value to the headers", async () => {
        const out = await emit(
            `import { Stat } from "./engine.d";\nfunction start() {\n    display_msg(Stat.STAT_ch);\n}\n`,
            { "engine.d.ts": "export declare enum Stat {\n    STAT_ch = 5,\n}\n" },
        );
        expect(out).toContain("display_msg(STAT_ch);");
        expect(out).not.toContain("#define STAT_ch");
    });
});
