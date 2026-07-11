/**
 * Runs enqueued async tasks strictly one at a time: each task starts only after the previous one has
 * settled, so concurrent callers cannot interleave their access to a shared resource.
 *
 * The dialog editor applies every webview edit as an async WorkspaceEdit (an LSP parse round-trip, then a
 * document splice). The webview can emit two "edit" messages back-to-back (a fast add-then-retarget), and
 * without serialization the two `applyEdit` calls run concurrently and their WorkspaceEdits race the same
 * document - VS Code then rejects the second with "applySplices: overlapping ops" (surfaced as an
 * unhandled promise rejection and an "unknown error" toast).
 *
 * A task's rejection is isolated to that task: it neither wedges the queue (later tasks still run) nor
 * escapes as an unhandled rejection - it is reported via the per-enqueue `onError` callback instead.
 */
export class SerialQueue {
    private tail: Promise<void> = Promise.resolve();

    enqueue(task: () => Promise<void>, onError?: (error: unknown) => void): void {
        this.tail = this.tail.then(task).catch((error) => {
            onError?.(error);
        });
    }

    /** Resolves once every task enqueued so far has settled (for tests and teardown). */
    async drain(): Promise<void> {
        await this.tail;
    }
}
