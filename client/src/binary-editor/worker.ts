// worker_threads entry for the binary editor core. Filled in by a later task.
import { parentPort } from "node:worker_threads";
if (!parentPort) throw new Error("binary-editor worker must be spawned with a parentPort");
parentPort.postMessage({ ready: true });
