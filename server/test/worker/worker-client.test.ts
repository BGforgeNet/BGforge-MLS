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

describe("a worker that stops answering", () => {
    const client = createWorkerClient<Req, Res>({ fileName, label: "test worker", timeoutMs: 300 });
    afterEach(() => client.stop());

    it("is replaced, so the next request is answered", async () => {
        await expect(client.send({ op: "wedge" })).rejects.toThrow("The test worker did not answer within 0.3s.");

        await expect(client.send({ op: "echo" })).resolves.toMatchObject({ echoed: "echo" });
    });
});
