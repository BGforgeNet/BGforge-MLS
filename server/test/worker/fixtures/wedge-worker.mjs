// A worker that answers `echo` and never returns from `wedge`, standing in for one stuck in synchronous code.
import { parentPort } from "node:worker_threads";

parentPort.on("message", (request) => {
    if (request.op === "wedge") {
        for (;;) {
            // Spins without yielding, so no later message is ever read.
        }
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker port's postMessage takes no origin; the rule is about window.postMessage.
    parentPort.postMessage({ id: request.id, echoed: request.op });
});
