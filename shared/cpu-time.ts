/**
 * The CPU time `work` takes on this thread, in milliseconds.
 *
 * For a bound on a call that must stay fast whatever the input: unlike the wall clock, CPU time does not grow when
 * other processes crowd the machine, so a bound sized for the call's own cost holds on a loaded one.
 */
export function cpuTimeMs(work: () => void): number {
    const before = process.threadCpuUsage();
    work();
    return cpuSince(before);
}

/** As `cpuTimeMs`, for work that returns a promise; only this thread's own computing is counted, not the waiting. */
export async function cpuTimeMsAsync(work: () => Promise<unknown>): Promise<number> {
    const before = process.threadCpuUsage();
    await work();
    return cpuSince(before);
}

function cpuSince(before: NodeJS.CpuUsage): number {
    const after = process.threadCpuUsage();
    return (after.user - before.user + (after.system - before.system)) / 1000;
}
