import { parentPort } from "node:worker_threads";
import { createWorkerHandler, type WorkerRequest } from "./worker-core";

if (!parentPort) throw new Error("binary-editor worker must be spawned with a parentPort");
const port = parentPort;
const handle = createWorkerHandler();

port.on("message", (msg: WorkerRequest) => {
    let response;
    try {
        response = handle(msg.request);
    } catch (error) {
        response = { type: "error" as const, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage({ id: msg.id, response });
});
