/**
 * Compiles several inputs at once, one worker thread per core.
 *
 * A compile is CPU-bound and single-threaded, and inputs do not interact - each is its own translation
 * unit, reading only its own source and the headers it includes - so a whole mod's worth of scripts is
 * work N cores can finish in a fraction of the time. One invocation over the 1525-script Restoration
 * Project corpus at -O2: 45.6s with -j1, 24.0s with -j2, 13.3s with -j4, 10.3s with -j8, on ten cores.
 *
 * Output is buffered per input and flushed IN INPUT ORDER, so a parallel run reads exactly like a
 * sequential one and two runs of the same command produce the same transcript. Workers therefore return
 * their lines rather than printing them; see `cli-task.ts`.
 */

import * as os from "node:os";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type { SslInput } from "./args";
import type { OutputLine, TaskArgs, TaskResult } from "./cli-task";

/** Sits beside the CLI bundle; both are emitted into `out/` by the same build. */
const WORKER_PATH = path.join(__dirname, "cli-worker.js");

/**
 * How many workers to run. One core is left for the main thread, which is doing the writing, and there is
 * no point starting more workers than there are inputs. `-j` overrides; `-j1` is how a caller whose build
 * system already parallelises turns this off.
 */
export function workerCount(requested: number, inputs: number): number {
    if (requested > 0) return Math.min(requested, inputs);
    const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
    return Math.max(1, Math.min(cores - 1, inputs));
}

interface Message {
    index: number;
    result: TaskResult;
}

/**
 * Runs every input across `jobs` workers and prints as results become flushable.
 *
 * @returns how many inputs failed.
 */
export async function runPool(
    inputs: readonly SslInput[],
    args: TaskArgs,
    jobs: number,
    emit: (line: OutputLine) => void,
): Promise<number> {
    const done = Array.from<TaskResult | undefined>({ length: inputs.length });
    let next = 0; // the next input to hand out
    let flushed = 0; // how far the in-order print has got
    let failures = 0;

    // Everything up to the first result still missing can be printed now; the rest waits for it. A worker
    // that finishes early therefore does not hold the transcript back, and one that is slow does not let
    // later inputs print ahead of it.
    const flush = (): void => {
        while (flushed < done.length) {
            const result = done[flushed];
            if (result === undefined) break;
            for (const line of result.lines) emit(line);
            if (!result.ok) failures++;
            flushed++;
        }
    };

    await new Promise<void>((resolve, reject) => {
        let live = 0;
        const workers: Worker[] = [];

        // Hands one input to a worker, or retires it when there are none left; the last one out resolves.
        const feed = (worker: Worker): void => {
            if (next >= inputs.length) {
                live--;
                void worker.terminate();
                if (live === 0) {
                    for (const other of workers) void other.terminate();
                    resolve();
                }
                return;
            }
            const index = next++;
            // A worker_threads port, not a window: its postMessage takes no target origin.
            // eslint-disable-next-line unicorn/require-post-message-target-origin
            worker.postMessage({ index, input: inputs[index] });
        };

        const start = (): void => {
            const worker = new Worker(WORKER_PATH, { workerData: { args } });
            workers.push(worker);
            live++;
            worker.on("message", (message: Message) => {
                done[message.index] = message.result;
                flush();
                feed(worker);
            });
            // A worker that dies takes the whole run with it: it has no partial answer to salvage, and
            // carrying on would report a success total that silently omits its inputs.
            worker.on("error", (error: Error) => {
                for (const other of workers) void other.terminate();
                reject(error);
            });
            feed(worker);
        };

        for (let i = 0; i < jobs; i++) start();
    });

    flush();
    return failures;
}
