/**
 * Shared helpers for the in-webview bundles (binary, dialog, and animation editors):
 * `installFatalErrorHandler` (global error/rejection reporting),
 * `installInitTimeout` + `DEFAULT_INIT_TIMEOUT_MS` (bounded host-reply wait),
 * and `isBenignWebviewError` (ResizeObserver-notice filtering, also used
 * directly by tests). These run in the webview's browser context, so the
 * module must stay free of Node and vscode-host APIs; esbuild inlines it
 * into each webview bundle.
 */

/** Minimal view of the `acquireVsCodeApi()` handle the helpers here need. */
interface VsCodeApi {
    postMessage(message: unknown): void;
}

export interface FatalErrorHandlerOptions {
    /** The `acquireVsCodeApi()` handle, used to report the error to the host. */
    readonly vscode: VsCodeApi;
    /**
     * Human label for this webview ("Dialog editor" / "Binary editor" / "Animation editor"). Drives
     * the console prefix and the default messages for uncaught errors; the
     * lowercased form is spliced into the "Unhandled ... error" defaults.
     */
    readonly label: string;
    /** Layout-specific teardown: replace the webview body with the error detail. */
    readonly render: (detail: string) => void;
}

/**
 * Chromium fires a window `error` event for "ResizeObserver loop completed with undelivered
 * notifications" (and the older-Chromium spelling "ResizeObserver loop limit exceeded") whenever many
 * ResizeObserver callbacks land in one animation frame - a scheduling notice, not an application failure;
 * the page keeps running correctly. Treating it as fatal blanks the webview on ordinary layout churn
 * (observed live: it fired during the dialog editor render harness's Duplicate-state flow, which
 * triggers Tree.svelte's tooltip-clip ResizeObserver). Matched by exact message so a real error that
 * merely mentions "ResizeObserver" is never swallowed.
 */
export function isBenignWebviewError(message: string): boolean {
    // Chromium's actual wording carries a trailing period; the pre-Chrome-64 wording did not - accept both.
    return /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)\.?$/.test(message);
}

/**
 * Wire the webview's global `error` + `unhandledrejection` handlers to a
 * one-shot fatal-error reporter: log to the console, forward to the host as a
 * `runtimeError` message, then hand the formatted detail to `render` for the
 * caller's layout-specific teardown. Fires at most once per webview lifetime.
 */
export function installFatalErrorHandler(options: FatalErrorHandlerOptions): void {
    const { vscode, label, render } = options;
    const lower = label.toLowerCase();
    let fatalErrorShown = false;

    const showFatalError = (message: string, error?: unknown): void => {
        if (fatalErrorShown) {
            return;
        }
        fatalErrorShown = true;

        const detail = error instanceof Error ? `${message}\n${error.stack ?? error.message}` : message;
        console.error(`${label} runtime error:`, error ?? message);
        vscode.postMessage({
            type: "runtimeError",
            message,
            stack: error instanceof Error ? error.stack : undefined,
        });
        render(detail);
    };

    globalThis.addEventListener("error", (event) => {
        const message = event.message || `Unhandled ${lower} error`;
        if (isBenignWebviewError(message)) return;
        showFatalError(message, event.error);
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        showFatalError(message || `Unhandled ${lower} promise rejection`, reason);
    });
}

/** Bounded wait for the host's initial reply, shared by the webviews. */
export const DEFAULT_INIT_TIMEOUT_MS = 8000;

export interface InitTimeoutOptions {
    /** How long the host may stay SILENT before `onTimeout` fires; each `bump()` restarts it. */
    readonly ms: number;
    /** Checked at the deadline: true means the expected reply already arrived, so onTimeout is skipped. */
    readonly isResolved: () => boolean;
    /** Called once, only if isResolved() is still false when the deadline hits. */
    readonly onTimeout: () => void;
}

/** Handle for a pending bounded wait. */
export interface InitWait {
    /** Restart the deadline: the host has shown it is alive, so the clock on SILENCE starts over. */
    bump: () => void;
    /** Cancel the pending timer - on unmount/dispose, or once the wait resolves. */
    cancel: () => void;
}

/**
 * Start a bounded wait on the host's reply: if `isResolved()` is still false `ms` after the last sign
 * of life, call `onTimeout()`.
 *
 * The deadline bounds SILENCE, not slowness. A host that is working produces liveness signals and the
 * caller `bump()`s on each, so a legitimately slow open never reports failure - MAPICONS.BAM decodes
 * to 5888 frames and takes longer than the whole budget to cross the webview boundary, and a fixed
 * deadline told the user the file did not open while it was opening. Only a host that says nothing at
 * all still trips it.
 *
 * Only the animation editor bumps. The dialog and binary editors were measured against the slowest
 * inputs their corpora hold - the largest WeiDU dialog and the largest area file - and both mount
 * with several times the budget to spare, so their deadline cannot fire on a healthy open and
 * wiring a liveness signal into them would guard a failure that does not exist.
 */
export function installInitTimeout(options: InitTimeoutOptions): InitWait {
    const { ms, isResolved, onTimeout } = options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
        timer = setTimeout(() => {
            if (!isResolved()) onTimeout();
        }, ms);
    };
    const cancel = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    arm();
    return {
        bump: () => {
            cancel();
            arm();
        },
        cancel,
    };
}

/**
 * A block this long or longer is worth reporting. Well above one dropped 16 ms frame: the point is to
 * surface a stall a user would feel as the panel going unresponsive, not ordinary render churn.
 */
export const SLOW_FRAME_MS = 150;

/**
 * Report every unbroken block of the webview's main thread lasting at least `thresholdMs`.
 *
 * A webview runs on its own thread inside its own frame, so a stall there is invisible to the host - a
 * layout or render that froze the panel left no trace anywhere a log could reach. The browser already
 * measures this ("longtask"), so this subscribes rather than measures.
 *
 * `ctor` is the seam: Node has no long-task entry type, so tests drive a stand-in. Missing or refusing the
 * entry type yields a no-op and a cleanup that does nothing - the observer is diagnostics and must never
 * be why a panel fails to come up.
 */
export function observeSlowFrames(
    thresholdMs: number,
    report: (ms: number) => void,
    Observer: typeof PerformanceObserver | undefined = globalThis.PerformanceObserver,
): () => void {
    const unobserved = (): void => {};
    if (Observer === undefined) return unobserved;
    const observer = new Observer((list) => {
        for (const entry of list.getEntries()) {
            if (entry.duration >= thresholdMs) report(Math.round(entry.duration));
        }
    });
    try {
        observer.observe({ entryTypes: ["longtask"] });
    } catch {
        // An engine that does not implement the entry type throws here rather than ignoring it.
        return unobserved;
    }
    return () => observer.disconnect();
}
