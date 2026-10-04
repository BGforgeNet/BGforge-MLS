import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

// Fake port that never replies, and exposes a hook to fire its error/exit channel - models a
// crashed/hung worker so the bridge's timeout and error-reject paths can be exercised in-process.
function silentPort(): Port & { fail(err: Error): void } {
    let errorCb: ((err: Error) => void) | undefined;
    return {
        postMessage() {
            /* never replies */
        },
        onMessage() {
            /* no responses */
        },
        onError(cb) {
            errorCb = cb;
        },
        dispose() {
            errorCb = undefined;
        },
        fail(err: Error) {
            errorCb?.(err);
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

    it("rejects a pending request when the timeout elapses with no reply", async () => {
        const bridge = new WorkerBridge(silentPort(), { timeoutMs: 20 });
        await expect(bridge.send({ type: "snapshot", sessionId: "s1" })).rejects.toThrow(/within 20ms/);
    });

    it("rejects all pending requests when the worker error/exit channel fires", async () => {
        const port = silentPort();
        const bridge = new WorkerBridge(port, { timeoutMs: 10_000 });
        const a = bridge.send({ type: "snapshot", sessionId: "s1" });
        const b = bridge.send({ type: "serialize", sessionId: "s1" });
        port.fail(new Error("worker crashed"));
        await expect(a).rejects.toThrow(/worker crashed/);
        await expect(b).rejects.toThrow(/worker crashed/);
    });

    // The pool parks a closed document's worker for the next one only on this word, so each way a worker can be
    // left wedged or mid-request must say no.
    describe("reusable", () => {
        it("is true once every request has been answered", async () => {
            const bridge = new WorkerBridge(fakePort());
            await bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
            expect(bridge.reusable).toBe(true);
        });

        it("is false while a request is in flight", () => {
            const bridge = new WorkerBridge(silentPort(), { timeoutMs: 10_000 });
            void bridge.send({ type: "snapshot", sessionId: "s1" }).catch(() => {});
            expect(bridge.reusable).toBe(false);
            bridge.dispose();
        });

        it("stays false after a request timed out", async () => {
            const bridge = new WorkerBridge(silentPort(), { timeoutMs: 5 });
            await expect(bridge.send({ type: "snapshot", sessionId: "s1" })).rejects.toThrow(/within 5ms/);
            expect(bridge.reusable).toBe(false);
        });

        it("stays false after the worker failed", () => {
            const port = silentPort();
            const bridge = new WorkerBridge(port);
            port.fail(new Error("worker crashed"));
            expect(bridge.reusable).toBe(false);
        });
    });

    // A recycled worker can still answer the previous bridge's last request after a new bridge took it over; an
    // id the new bridge also issued would resolve the wrong request with that stale reply.
    it("never issues an id another bridge already used", () => {
        const ids: number[] = [];
        const recording = (): Port => ({
            postMessage: (msg) => ids.push(msg.id),
            onMessage: () => {},
            dispose: () => {},
        });
        const first = new WorkerBridge(recording(), { timeoutMs: 10_000 });
        const second = new WorkerBridge(recording(), { timeoutMs: 10_000 });
        for (const bridge of [first, second, first])
            void bridge.send({ type: "snapshot", sessionId: "s" }).catch(() => {});
        first.dispose();
        second.dispose();
        expect(new Set(ids).size).toBe(3);
    });

    it("clears the timeout once a reply arrives so a resolved request never rejects", async () => {
        vi.useFakeTimers();
        try {
            const bridge = new WorkerBridge(fakePort(), { timeoutMs: 20 });
            // The fakePort delivers via queueMicrotask, which fake timers still
            // drain through microtask flushing.
            const pending = bridge.send({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
            // Flush microtasks so the port's queued reply resolves the promise.
            await Promise.resolve();
            const res = await pending;
            expect(res.type).toBe("opened");
            // Advance well past the timeout: if the timer was not cleared, it
            // would fire and reject the already-resolved promise at this point.
            vi.advanceTimersByTime(100);
            // Re-await pending microtasks to surface any late rejection.
            await Promise.resolve();
        } finally {
            vi.useRealTimers();
        }
    });
});
