/**
 * Smoke test: the compiler half of the shared ts-morph worker as the extension actually loads it - the
 * built bundle, on a real thread, over the real message protocol. Requires `pnpm build:base:server`.
 *
 * Everything else about this worker is tested with the thread replaced, so nothing else would notice
 * the bundle being absent, emitted under another name, or failing to load. That break costs the whole
 * feature and looks like a compiler that silently stopped working.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompileRequest, CompileResponse } from "../src/tssl/compile-worker-protocol";

const WORKER_PATH = join(__dirname, "..", "out", "ts-morph-worker.js");
const SOURCE = "function start(): void {\n    let n = 1;\n    n = n + 1;\n}\n";

let dir: string;
let worker: Worker;
let nextId = 0;
const pending = new Map<number, (response: CompileResponse) => void>();
const failed = new Map<number, (error: Error) => void>();
/** Set once the worker reports it cannot run, so the cases after the first fail on it too. */
let dead: Error | undefined;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tssl-worker-smoke-"));
    worker = new Worker(WORKER_PATH);
    worker.on("message", (response: CompileResponse) => pending.get(response.id)?.(response));
    // A bundle that is absent or will not load answers nothing, and the break this suite exists to
    // catch would otherwise surface as three tests sitting out their timeout.
    worker.on("error", (error: Error) => {
        dead = error;
        for (const [, reject] of failed) reject(error);
        failed.clear();
        pending.clear();
    });
});

afterAll(async () => {
    await worker?.terminate();
    if (dir) await rm(dir, { recursive: true, force: true });
});

async function compile(request: Omit<CompileRequest, "id" | "kind">): Promise<CompileResponse> {
    if (dead) throw new Error(`the worker cannot run: ${dead.message}`);
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        failed.set(id, reject);
        // `kind` selects the compiler half of the shared bundle, exactly as the client adds it.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
        worker.postMessage({ ...request, id, kind: "compile" } satisfies CompileRequest);
    });
}

describe("the built TSSL compile worker", () => {
    it("compiles a source to bytecode on its own thread", async () => {
        const filepath = join(dir, "ok.tssl");
        const intPath = join(dir, "ok.int");
        await writeFile(filepath, SOURCE, "utf-8");

        const response = await compile({
            text: SOURCE,
            filepath,
            intPath,
            sslPath: null,
            level: 2,
            shortCircuit: true,
        });

        expect(response.failure).toBeUndefined();
        const bytes = await readFile(intPath);
        // Fallout bytecode opens with the header the engine reads; anything shorter is not a script.
        expect(bytes.length).toBeGreaterThan(16);
    });

    it("writes the readable SSL as well when asked for it", async () => {
        const filepath = join(dir, "with-ssl.tssl");
        await writeFile(filepath, SOURCE, "utf-8");
        const sslPath = join(dir, "with-ssl.ssl");

        const response = await compile({
            text: SOURCE,
            filepath,
            intPath: join(dir, "with-ssl.int"),
            sslPath,
            level: 2,
            shortCircuit: true,
        });

        expect(response.failure).toBeUndefined();
        expect(await readFile(sslPath, "utf-8")).toContain("procedure start");
    });

    // The refusal is thrown as a class the clone cannot carry, so this is where its position would be
    // lost without the protocol flattening it.
    it("reports a refusal with the line it sits on, and writes nothing", async () => {
        const filepath = join(dir, "bad.tssl");
        const intPath = join(dir, "bad.int");
        const text = "function start(): void {\n    let n = 1;\n    n = nope;\n}\n";
        await writeFile(filepath, text, "utf-8");

        const response = await compile({ text, filepath, intPath, sslPath: null, level: 2, shortCircuit: true });

        expect(response.failure).toEqual({ message: "unknown identifier 'nope'", file: filepath, line: 3 });
        await expect(readFile(intPath)).rejects.toThrow(/ENOENT/);
    });
});
