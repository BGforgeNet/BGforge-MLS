/**
 * Fire-and-forget wrapper for the LSP refresh requests (`semanticTokens/refresh`, `inlayHint/refresh`).
 *
 * A refresh only asks the client to re-pull; nothing downstream waits on it, so every call site drops the
 * promise. The rejection still has to be consumed: a client that does not implement the refresh request
 * rejects it, and an unhandled rejection ends the server process. One helper so that decision - swallow,
 * do not report - lives in a single place rather than once per handler.
 */
export function fireRefresh(refresh: () => Promise<void>): void {
    refresh().catch(() => {
        // The client declined or does not support the refresh; there is nothing to recover or surface.
    });
}
