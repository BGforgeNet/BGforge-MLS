/**
 * What a reused ts-morph project has to keep honest.
 *
 * Reuse is what makes a second compile cost tens of milliseconds instead of the ~700 ms a first one
 * does, and the whole of that saving is work not repeated - including reading the files again. So the
 * cases here are the ones where something changed and the project would otherwise not notice: they are
 * multi-invocation by construction, because a single compile cannot go stale.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBatchState, transpile } from "../src/index";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-batch-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let caseSeq = 0;

/** A case's own directory, so one case's imports cannot resolve to another's files. */
function caseDir(): string {
    const dir = path.join(tmpDir, `case${caseSeq++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

describe("a reused batch", () => {
    it("picks up an edit to an imported file", async () => {
        const dir = caseDir();
        const dep = path.join(dir, "shared.ts");
        const entry = path.join(dir, "main.tssl");
        const source = 'import { Answer } from "./shared";\nfunction start() {\n    let n = Answer.Value;\n}\n';
        fs.writeFileSync(entry, source, "utf-8");
        fs.writeFileSync(dep, "export const enum Answer { Value = 111 }\n", "utf-8");

        const batch = createBatchState();
        expect(await transpile(entry, source, batch)).toContain("#define Answer_Value 111");

        fs.writeFileSync(dep, "export const enum Answer { Value = 222 }\n", "utf-8");

        expect(await transpile(entry, source, batch)).toContain("#define Answer_Value 222");
    });

    // The entry is keyed by a path that does not change between compiles, so nothing else would notice
    // that its text did - and its @inline functions are the part of it that gets cached. The body has
    // to be a single call, which is the only shape the macro extractor reads.
    it("picks up an edit to an inline function in the entry itself", async () => {
        const dir = caseDir();
        const entry = path.join(dir, "main.tssl");
        const before =
            "/** @inline */\nfunction bump(n: number) {\n    return global_var(n);\n}\nfunction start() {\n    let x = bump(1);\n}\n";
        const after = before.replace("global_var(n)", "local_var(n)");
        fs.writeFileSync(entry, before, "utf-8");

        const batch = createBatchState();
        expect(await transpile(entry, before, batch)).toContain("#define bump(n) global_var(n)");

        fs.writeFileSync(entry, after, "utf-8");

        expect(await transpile(entry, after, batch)).toContain("#define bump(n) local_var(n)");
    });

    // The editor compiles the buffer, not the file: bringing dependencies up to date must not reach the
    // entry, whose text is whatever the caller passed.
    it("compiles the text it was handed, not what is on disk under that name", async () => {
        const dir = caseDir();
        const entry = path.join(dir, "main.tssl");
        fs.writeFileSync(entry, "function start() {\n    let saved = 1;\n}\n", "utf-8");

        const batch = createBatchState();
        await transpile(entry, fs.readFileSync(entry, "utf-8"), batch);

        const unsaved = "function start() {\n    let edited = 2;\n}\n";
        const out = await transpile(entry, unsaved, batch);

        expect(out).toContain("edited");
        expect(out).not.toContain("saved");
    });
});
