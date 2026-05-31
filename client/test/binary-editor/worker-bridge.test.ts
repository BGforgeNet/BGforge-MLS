import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkerBridge, type Port } from "../../src/binary-editor/worker-bridge";
import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from "../../src/binary-editor/worker-core";

const MAP_FIXTURE = path.resolve(__dirname, "../../testFixture/maps/arcaves.map");
const bytes = () => new Uint8Array(fs.readFileSync(MAP_FIXTURE));

// In-process fake port: routes each request through the real handler, replying async.
function fakePort(): Port {
    const handle = createWorkerHandler();
    let listener: ((m: WorkerResponse) => void) | undefined;
    return {
        postMessage(msg: WorkerRequest) {
            const response = handle(msg.request);
            queueMicrotask(() => listener?.({ id: msg.id, response }));
        },
        onMessage(cb) {
            listener = cb;
        },
        dispose() {
            listener = undefined;
        },
    };
}

describe("WorkerBridge", () => {
    it("resolves a request with the matching response", async () => {
        const bridge = new WorkerBridge(fakePort());
        const res = await bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
        expect(res.type).toBe("opened");
    });

    it("correlates concurrent requests to the right responses", async () => {
        const bridge = new WorkerBridge(fakePort());
        const opened = await bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
        if (opened.type !== "opened") throw new Error("expected opened");
        const id = opened.result.sessionId;
        const [w, snap] = await Promise.all([
            bridge.send({ type: "getWindow", sessionId: id, start: 0, end: 5 }),
            bridge.send({ type: "snapshot", sessionId: id }),
        ]);
        expect(w.type).toBe("window");
        expect(snap.type).toBe("snapshot");
    });
});
