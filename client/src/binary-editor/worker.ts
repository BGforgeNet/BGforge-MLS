import { parentPort } from "node:worker_threads";
import { createWorkerHandler, type WorkerRequest } from "./worker-core";
import { errorText } from "@bgforge/shared/error-text";

if (!parentPort) throw new Error("binary-editor worker must be spawned with a parentPort");
const port = parentPort;
const handle = createWorkerHandler();

port.on("message", (msg: WorkerRequest) => {
    let response;
    try {
        response = handle(msg.request);
    } catch (error) {
        response = { type: "error" as const, message: errorText(error) };
    }
    port.postMessage({ id: msg.id, response });
});
