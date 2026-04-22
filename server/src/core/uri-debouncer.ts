/**
 * Per-URI debouncer: schedules a callback keyed by URI, replacing any
 * previously pending call for the same key. Used to coalesce rapid
 * file-change events before triggering reloads or compilations.
 */

export class UriDebouncer<K extends string = string> {
    private readonly timers = new Map<K, ReturnType<typeof setTimeout>>();
    private readonly delayMs: number;

    constructor(delayMs: number) {
        this.delayMs = delayMs;
    }

    /** Schedule fn to run after delayMs. Cancels any pending call for the same key. */
    schedule(key: K, fn: () => void): void {
        const existing = this.timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            fn();
        }, this.delayMs));
    }

    /** Cancel a pending call. Returns true if one was cancelled. */
    cancel(key: K): boolean {
        const existing = this.timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
            this.timers.delete(key);
            return true;
        }
        return false;
    }

    /** Returns true if a call is pending for this key. */
    has(key: K): boolean {
        return this.timers.has(key);
    }

    /** Cancel all pending calls and clear the map. Call on shutdown. */
    dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
