/**
 * Latency measurement for operations that hold a thread.
 *
 * One definition for every surface that needs it. The LSP server wraps its request handlers with it
 * (`server/src/shared/time-handler.ts`); the extension host wraps the synchronous work that blocks the
 * VS Code UI (`client/src/timing.ts`). Both want the same thing - run it, time it, say so when it took
 * longer than the budget - and a second copy would drift in exactly the detail that matters, which is
 * whether async work is measured to its settlement or only to when it was kicked off.
 *
 * Only the over-budget case is reported: a log line per fast operation would bury the slow ones.
 */

export interface TimingOptions {
    /** Where a report goes. The server routes it to the LSP console, the host to its output channel. */
    warn: (message: string) => void;
    /** Report only when the operation takes longer than this. */
    thresholdMs: number;
    /** Names the surface in the log line, so one channel's entries stay attributable. */
    tag: string;
}

/**
 * Run `work`, timing it. Returns whatever `work` returns; a promise is timed to its settlement, and an
 * error - thrown or rejected - is reported with its elapsed time and then propagates untouched.
 */
export function timed<T>(name: string, options: TimingOptions, work: () => T): T {
    const { warn, thresholdMs, tag } = options;
    const start = performance.now();
    const elapsed = (): number => Math.round(performance.now() - start);
    const report = (what: string): void => warn(`[${tag}] ${name} ${what}`);
    const done = (): void => {
        const ms = elapsed();
        if (ms > thresholdMs) report(`took ${ms}ms`);
    };

    let result: T;
    try {
        result = work();
    } catch (error) {
        // A throw is always worth reporting, however fast: it says the operation did not do its job.
        report(`threw after ${elapsed()}ms`);
        throw error;
    }

    if (result instanceof Promise) {
        // Timing the synchronous return of an async function measures nothing, so carry the measurement
        // onto its settlement. The chain is re-asserted to T because this branch is where T IS a promise.
        return result.then(
            (value) => {
                done();
                return value;
            },
            (error: unknown) => {
                report(`threw after ${elapsed()}ms`);
                throw error;
            },
        ) as unknown as T;
    }

    done();
    return result;
}
