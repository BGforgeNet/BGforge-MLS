/**
 * Smoke test: the transpile worker as the extension actually loads it - the built bundle, on a real
 * thread, over the real message protocol. Requires `pnpm build:base:server` to have run.
 *
 * `transpile-worker.test.ts` exercises the same work with the thread replaced, so nothing there would
 * notice the bundle being absent, emitted under another name, or failing to load. That break takes out
 * every transpile and every dialog-editor open at once, and looks like a server that silently stopped
 * answering - the same gap `tssl-worker-smoke.test.ts` covers for the compile worker.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DDialogData } from "../../shared/dialog-types";
import type { TranspileRequest, TranspileResponse } from "../src/transpile/transpile-worker-protocol";

const WORKER_PATH = join(__dirname, "..", "out", "ts-morph-worker.js");
const TD_SAMPLE = join(__dirname, "td", "samples", "familiars_v2.td");

let worker: Worker;
let nextId = 0;
const pending = new Map<number, (response: TranspileResponse) => void>();
const failed = new Map<number, (error: Error) => void>();
/** Set once the worker reports it cannot run, so the cases after the first fail on it too. */
let dead: Error | undefined;

beforeAll(() => {
    worker = new Worker(WORKER_PATH);
    worker.on("message", (response: TranspileResponse) => pending.get(response.id)?.(response));
    // A bundle that is absent or will not load answers nothing, and the break this suite exists to
    // catch would otherwise surface as the cases sitting out their timeout.
    worker.on("error", (error: Error) => {
        dead = error;
        for (const [, reject] of failed) reject(error);
        failed.clear();
        pending.clear();
    });
});

afterAll(async () => {
    await worker?.terminate();
});

async function send(request: Omit<TranspileRequest, "id">): Promise<TranspileResponse> {
    if (dead) throw new Error(`the worker cannot run: ${dead.message}`);
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        failed.set(id, reject);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
        worker.postMessage({ ...request, id } satisfies TranspileRequest);
    });
}

describe("the built transpile worker", () => {
    it("transpiles a TD source to WeiDU D on its own thread", async () => {
        const text = readFileSync(TD_SAMPLE, "utf8");

        const response = await send({ kind: "td", filepath: TD_SAMPLE, text });

        expect(response.failure).toBeUndefined();
        // A D file names the states it defines, so the sample's first state has to appear in the output.
        expect(response.result?.output).toContain("g_familiar_follow");
    });

    it("parses a TD source into the model the dialog editor renders", async () => {
        const text = readFileSync(TD_SAMPLE, "utf8");

        const response = await send({ kind: "parse-td", filepath: TD_SAMPLE, text });

        expect(response.failure).toBeUndefined();
        const parsed = response.parsed as DDialogData;
        expect(parsed.states.map((state) => state.label)).toContain("g_familiar_follow");
    });

    // The refusal is thrown as a class the structured clone cannot carry, so this is the trip where its
    // position would be lost without the protocol flattening it. Same input as the unit test's case:
    // `alterTrans` naming a state that was never begun, which refuses on line 3.
    it("reports a refusal across the thread with its position intact", async () => {
        const refused = `export default begin("MYFOO", []);\n\nalterTrans("MYFOO", 1);\n`;

        const response = await send({ kind: "td", filepath: TD_SAMPLE, text: refused });

        expect(response.result).toBeUndefined();
        expect(response.failure?.message).toContain("alterTrans()");
        expect(response.failure?.line).toBe(3);
    });
});
