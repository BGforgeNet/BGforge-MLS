/**
 * TSSL constructs against the reference compiler: the SSL text `--ssl` writes is compiled by the reference,
 * and the result must equal, byte for byte, the bytecode the direct route produces from the same source.
 *
 * Only a compile proves the text route writes SSL; a string match on the text pins whatever was written,
 * accepted or not. The corpus differentials cannot stand in, because they reach only what the corpus uses.
 *
 * Needs the reference compiler (an optional dependency) and skips without it, the case count asserted
 * so a skip cannot read as a pass.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { emitProgram, optimize } from "@bgforge/ssl";
import { REPO_ROOT } from "../../../transpilers/test/repo-root";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout";
import { createBatchState, transpile } from "../src/index";
import { lowerTsslProgram } from "../src/int/lower";

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
    }
}

const compiler = findCompiler();
const batch = createBatchState();
let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-reference-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Each source is a module (`export`): every case shares one project, where scripts would share one global
// scope and a helper declared in two cases would collide.
interface Case {
    name: string;
    source: string;
}

const CASES: Case[] = [
    {
        name: "ternary",
        source: "export function start() {\n    let x = global_var(1) ? 10 : 20;\n    display_msg(x);\n}\n",
    },
    {
        name: "ternary chain",
        source: "export function start() {\n    display_msg(global_var(1) ? 1 : global_var(2) ? 2 : 3);\n}\n",
    },
    {
        name: "ternary nested in the value",
        source: "export function start() {\n    display_msg(global_var(1) ? global_var(2) ? 1 : 2 : 3);\n}\n",
    },
    {
        // SSL writes the value before the condition, and the string table follows the order the source
        // mentions each literal, so a string in each operand checks that order.
        name: "ternary with strings in the value and the condition",
        source: 'export function start() {\n    let s = "b";\n    display_msg(s == "a" ? "yes" : "no");\n}\n',
    },
    {
        name: "ternary as an operand and a return value",
        source:
            "function pick(a: number) {\n    return 1 + (a > 2 ? a : 2) * 3;\n}\n" +
            "export function start() {\n    display_msg(pick(global_var(1)));\n    display_msg(-(global_var(1) ? 1 : 2));\n}\n",
    },
    {
        // SSL's `floor` is a prefix operator, not an engine function, so `floor(x) + 1` is `(floor x) + 1`.
        name: "floor",
        source: "export function start() {\n    display_msg(floor(global_var(1) / 2.0) + 1);\n}\n",
    },
    {
        name: "set_perk_skill1_mag",
        source: "export function start() {\n    set_perk_skill1_mag(1, global_var(2));\n}\n",
    },
];

async function compareWithReference(name: string, source: string, level: 0 | 2): Promise<void> {
    const stem = `${name.replaceAll(/\W+/g, "_")}_O${level}`;
    const tsslPath = path.join(tmpDir, `${stem}.tssl`);
    fs.writeFileSync(tsslPath, source, "utf-8");

    const ssl = await transpile(tsslPath, source, batch);
    fs.writeFileSync(path.join(tmpDir, `${stem}.ssl`), ssl, "utf-8");
    const reference = spawnSync(
        process.execPath,
        [compiler as string, `-O${level}`, "-q", "-p", `${stem}.ssl`, "-o", `${stem}.int`],
        { cwd: tmpDir, encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS },
    );
    if (reference.error) throw reference.error;
    // The reference reports a refusal on stdout; the message is what says which construct it could not read.
    expect(reference.status, `reference refused:\n${reference.stdout}${reference.stderr}\nSSL:\n${ssl}`).toBe(0);
    const expected = new Uint8Array(fs.readFileSync(path.join(tmpDir, `${stem}.int`)));

    const options = { level };
    const actual = emitProgram(optimize(lowerTsslProgram(tsslPath, source, batch), options), options);
    expect([...actual], `ref ${expected.length} bytes, direct ${actual.length}; SSL:\n${ssl}`).toEqual([...expected]);
}

describe.skipIf(compiler === null)("TSSL compiles as the reference compiles its SSL", () => {
    it("covers every case in the table", () => {
        expect(CASES.length).toBe(7);
    });

    it.each(CASES)("$name", async ({ name, source }) => {
        await compareWithReference(name, source, 0);
    });

    it.each(CASES)("$name at -O2", async ({ name, source }) => {
        await compareWithReference(name, source, 2);
    });
});
