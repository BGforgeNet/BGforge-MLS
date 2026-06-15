import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkerBridge, workerPort } from "../../src/binary-editor/worker-bridge";

const MAP_FIXTURE = path.resolve(__dirname, "../../testFixture/maps/arcaves.map");
const REPO = path.resolve(__dirname, "../../..");
const OUT = path.join(os.tmpdir(), `bgforge-be-worker-${process.pid}.cjs`);

describe("worker integration", () => {
    let bridge: WorkerBridge;
    let worker: Worker;

    beforeAll(async () => {
        await build({
            entryPoints: [path.resolve(__dirname, "../../src/binary-editor/worker.ts")],
            bundle: true,
            platform: "node",
            format: "cjs",
            outfile: OUT,
            external: ["vscode"],
            alias: {
                "@bgforge/binary": path.join(REPO, "binary/src/index.ts"),
                "@bgforge/binary-editor": path.join(REPO, "binary-editor/src/index.ts"),
            },
        });
        worker = new Worker(OUT);
        bridge = new WorkerBridge(workerPort(worker));
    });

    afterAll(async () => {
        bridge?.dispose();
        await worker?.terminate();
        fs.rmSync(OUT, { force: true });
    });

    it("round-trips an unedited map through the spawned worker", async () => {
        const original = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const opened = await bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: original });
        if (opened.type !== "opened") throw new Error("expected opened");
        const ser = await bridge.send({ type: "serialize", sessionId: opened.result.sessionId });
        if (ser.type !== "serialized") throw new Error("expected serialized");
        expect(Buffer.from(ser.bytes).equals(Buffer.from(original))).toBe(true);
    });

    it("answers getChildren and round-trips loadJson through the spawned worker", async () => {
        const bytes = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const opened = await bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes });
        expect(opened.type).toBe("opened");
        if (opened.type !== "opened") throw new Error("expected opened");
        const sid = opened.result.sessionId;

        const kids = await bridge.send({ type: "getChildren", sessionId: sid, nodeId: null, start: 0, end: 10 });
        expect(kids.type).toBe("children");

        const snap = await bridge.send({ type: "snapshot", sessionId: sid });
        expect(snap.type).toBe("snapshot");
        if (snap.type !== "snapshot") throw new Error("expected snapshot");
        const loaded = await bridge.send({ type: "loadJson", sessionId: sid, json: snap.json });
        expect(loaded.type).toBe("opened");
    });
});
