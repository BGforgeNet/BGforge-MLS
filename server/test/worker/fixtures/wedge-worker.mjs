// A worker that answers `echo` and never returns from `wedge`, standing in for one stuck in synchronous code.
// A `wedge` request may carry a shared Int32Array: slot 0 is set and notified just before the spin, so the sender
// knows the worker has the request and is stuck.
import { parentPort } from "node:worker_threads";

parentPort.on("message", (request) => {
    if (request.op === "wedge") {
        if (request.flag) {
            Atomics.store(request.flag, 0, 1);
            Atomics.notify(request.flag, 0);
        }
        for (;;) {
            // Spins without yielding, so no later message is ever read.
        }
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker port's postMessage takes no origin; the rule is about window.postMessage.
    parentPort.postMessage({ id: request.id, echoed: request.op });
});
