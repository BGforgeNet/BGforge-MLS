/**
 * One worker of the CLI's compile pool: loads the grammar once, then compiles whatever inputs it is sent.
 *
 * The grammar load is the expensive part of starting up and is why a worker is kept and fed rather than
 * spawned per input. Results go back as VALUES - the lines to print included - because the main thread
 * owns the transcript's order; see `cli-pool.ts`.
 */

import { parentPort, workerData } from "node:worker_threads";
import type { SslInput } from "./args";
import { runInput, type TaskArgs } from "./cli-task";
import { initParser } from "../../../shared/parsers/fallout-ssl";

interface Task {
    index: number;
    input: SslInput;
}

const port = parentPort;
if (port === null) throw new Error("cli-worker must be started as a worker thread");

const args = (workerData as { args: TaskArgs }).args;

// Tasks that arrive before the grammar has finished loading queue behind it rather than racing it.
const ready = initParser();

port.on("message", (task: Task) => {
    void ready.then(() => {
        port.postMessage({ index: task.index, result: runInput(task.input, args) });
    });
});
