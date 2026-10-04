import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerPool, type PoolWorker } from "../../src/binary-editor/worker-pool";

/** A worker that records what the pool did to it. */
class FakeWorker implements PoolWorker {
    terminated = false;
    refed = true;
    terminate(): Promise<number> {
        this.terminated = true;
        return Promise.resolve(0);
    }
    unref(): void {
        this.refed = false;
    }
    ref(): void {
        this.refed = true;
    }
}

function pool(idleMs = 60_000) {
    const spawned: FakeWorker[] = [];
    const p = new WorkerPool<FakeWorker>(() => {
        const w = new FakeWorker();
        spawned.push(w);
        return w;
    }, idleMs);
    return { p, spawned };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("WorkerPool", () => {
    it("spawns a worker when none is parked", () => {
        const { p, spawned } = pool();
        const w = p.acquire();
        expect(spawned).toEqual([w]);
        expect(w.refed).toBe(true);
    });

    it("hands out the pre-started spare instead of spawning", () => {
        const { p, spawned } = pool();
        p.prestart();
        const spare = spawned[0]!;
        expect(spare.refed).toBe(false); // an idle spare must not hold the host process open

        expect(p.acquire()).toBe(spare);
        expect(spawned).toHaveLength(1);
        expect(spare.refed).toBe(true);
    });

    it("keeps at most one spare", () => {
        const { p, spawned } = pool();
        p.prestart();
        p.prestart();
        expect(spawned).toHaveLength(1);
    });

    it("parks a cleanly released worker for the next document", () => {
        const { p, spawned } = pool();
        const w = p.acquire();
        p.release(w, true);
        expect(w.terminated).toBe(false);
        expect(p.acquire()).toBe(w);
        expect(spawned).toHaveLength(1);
    });

    it("ends a worker released as not reusable", () => {
        const { p } = pool();
        const w = p.acquire();
        p.release(w, false);
        expect(w.terminated).toBe(true);
        expect(p.acquire()).not.toBe(w);
    });

    it("ends a released worker when a spare is already parked", () => {
        const { p, spawned } = pool();
        const w = p.acquire();
        p.prestart();
        p.release(w, true);
        expect(w.terminated).toBe(true);
        expect(p.acquire()).toBe(spawned[1]);
    });

    it("ends the spare after the idle timeout", () => {
        vi.useFakeTimers();
        const { p, spawned } = pool(1000);
        p.prestart();
        vi.advanceTimersByTime(999);
        expect(spawned[0]!.terminated).toBe(false);
        vi.advanceTimersByTime(1);
        expect(spawned[0]!.terminated).toBe(true);
        // Gone, not merely flagged: the next open spawns.
        expect(p.acquire()).toBe(spawned[1]);
    });

    it("does not end a spare that was taken before its timeout", () => {
        vi.useFakeTimers();
        const { p, spawned } = pool(1000);
        p.prestart();
        const w = p.acquire();
        vi.advanceTimersByTime(5000);
        expect(w).toBe(spawned[0]);
        expect(w.terminated).toBe(false);
    });

    it("ends the spare on dispose and parks nothing afterwards", () => {
        const { p, spawned } = pool();
        p.prestart();
        const inUse = p.acquire();
        p.prestart();
        p.dispose();
        expect(spawned[1]!.terminated).toBe(true);
        p.release(inUse, true);
        expect(inUse.terminated).toBe(true);
        p.prestart();
        expect(spawned).toHaveLength(2);
    });
});
