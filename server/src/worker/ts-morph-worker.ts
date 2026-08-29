/**
 * The one worker bundle that carries ts-morph, and the message loop both its users share.
 *
 * The TSSL compiler and the TD/TBAF transpilers each need ts-morph and each need to be off the server
 * thread, and a worker thread is started from a FILE - so two entry points meant two bundles, each
 * ~90% ts-morph, and the VSIX carried the library twice: 1,647,506 and 1,683,335 bytes compressed, a
 * third of a 10.2 MB artifact. Serving both from this file leaves one copy.
 *
 * It stays TWO INSTANCES, not one. A worker has one event loop and both workloads are synchronous CPU,
 * so a shared instance would queue a ~10 ms dialog parse behind a first TSSL compile of ~690 ms. The
 * instances are separate because of that, not because the code had to be; each client owns one and
 * only ever sends its own kinds, so the other half of this file is dead weight in each - dead weight
 * that costs nothing at run time and saves a whole copy of ts-morph on disk.
 */

import { parentPort } from "node:worker_threads";
import { handleCompile } from "../tssl/compile-worker";
import { runTranspile } from "../transpile/transpile-worker";
import type { WorkerRequest, WorkerResponse } from "./ts-morph-worker-protocol";

/**
 * One request at a time. The compiler serialises because every request mutates the one project it
 * keeps; the transpilers serialise so a slow transpile does not interleave with the next request's
 * bundling step. Since an instance only ever receives one side's kinds, this queue is that side's.
 */
let queue: Promise<void> = Promise.resolve();

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
    return request.kind === "compile" ? await handleCompile(request) : await runTranspile(request);
}

parentPort?.on("message", (request: WorkerRequest) => {
    queue = queue.then(async () => {
        const response = await handle(request);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker port's postMessage takes no origin; the rule is about window.postMessage.
        parentPort?.postMessage(response);
    });
});
