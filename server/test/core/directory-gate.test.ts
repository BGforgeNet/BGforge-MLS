/**
 * Compiles that share a working directory must not run at the same time.
 *
 * The compiler writes its preprocessor scratch file under a name that is constant for a given directory,
 * so two concurrent compiles there overwrite each other's intermediate source. The damage is not confined
 * to a failed run: one process reads back a file the other is still writing and reports syntax errors
 * against whatever it happened to see, naming a header the user never edited.
 */

import { describe, expect, it } from "vitest";
import { withDirectoryGate } from "../../src/core/directory-gate";

/** Runs `count` gated bodies at once and reports how many were ever in flight together. */
async function peakOverlap(dirs: readonly string[]): Promise<number> {
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
        dirs.map((dir) =>
            withDirectoryGate(dir, async () => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                // Hold the directory across a timer, so an ungated body is observed overlapping rather
                // than finishing within its own microtask.
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 5);
                });
                inFlight--;
            }),
        ),
    );
    return peak;
}

describe("withDirectoryGate", () => {
    it("never runs two bodies in the same directory at once", async () => {
        expect(await peakOverlap(["/work/scripts", "/work/scripts", "/work/scripts"])).toBe(1);
    });

    it("lets different directories run at the same time", async () => {
        expect(await peakOverlap(["/work/a", "/work/b", "/work/c"])).toBe(3);
    });

    // The gate keys on the directory, so two spellings of one directory have to land on one key or the
    // scratch file they share is left unguarded.
    it("treats different spellings of one directory as the same directory", async () => {
        expect(await peakOverlap(["/work/scripts", "/work/scripts/", "/work/./scripts"])).toBe(1);
    });

    it("releases the directory when a body throws", async () => {
        const failure = withDirectoryGate("/work/scripts", () => Promise.reject(new Error("compile blew up")));
        await expect(failure).rejects.toThrow("compile blew up");

        // The gate is free again: a later body runs rather than waiting on a lock nobody released.
        await expect(withDirectoryGate("/work/scripts", () => Promise.resolve("ran"))).resolves.toBe("ran");
    });

    it("hands back what the body returned", async () => {
        await expect(withDirectoryGate("/work/scripts", () => Promise.resolve(42))).resolves.toBe(42);
    });

    it("runs queued bodies in the order they arrived", async () => {
        const order: number[] = [];
        await Promise.all(
            [1, 2, 3].map((n) =>
                withDirectoryGate("/work/scripts", async () => {
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, 1);
                    });
                    order.push(n);
                }),
            ),
        );
        expect(order).toEqual([1, 2, 3]);
    });
});
