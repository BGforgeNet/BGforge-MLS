/**
 * A worker presumed wedged is replaced, not kept: it reads requests in order, so every later one would wait
 * behind the stuck one and time out in turn.
 */

import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger", () => ({ conlog: vi.fn() }));

const { createWorkerClient } = await import("../../src/worker/worker-client");

interface Req {
    id: number;
    op: string;
    /** Shared with the fixture, which sets slot 0 just before it wedges. */
    flag?: Int32Array;
}
interface Res {
    id: number;
    echoed: string;
}

// The client resolves the bundle beside its own module; this points it at the fixture instead.
const fileName = path.relative(
    path.resolve(__dirname, "../../src/worker"),
    path.resolve(__dirname, "fixtures/wedge-worker.mjs"),
);

const TIMEOUT_MS = 300;

describe("a worker that stops answering", () => {
    const client = createWorkerClient<Req, Res>({ fileName, label: "test worker", timeoutMs: TIMEOUT_MS });
    afterEach(async () => {
        vi.useRealTimers();
        await client.stop();
    });

    it("is replaced, so the next request is answered", async () => {
        // The request timer is the clock under test, so it is driven by hand: a real one also runs while the
        // replacement is spawned and loads its bundle, which on a loaded machine outlasts any bound short
        // enough to keep the test quick. Only the timers are faked; messages between threads stay real.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const stuck = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
        const wedged = client.send({ op: "wedge", flag: stuck });
        const rejection = expect(wedged).rejects.toThrow("The test worker did not answer within 0.3s.");
        // The timer fires only once the worker has taken the request and is spinning on it.
        await Atomics.waitAsync(stuck, 0, 0).value;
        vi.advanceTimersByTime(TIMEOUT_MS);
        await rejection;

        await expect(client.send({ op: "echo" })).resolves.toMatchObject({ echoed: "echo" });
    });
});
