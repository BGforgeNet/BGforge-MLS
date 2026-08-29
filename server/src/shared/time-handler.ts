/**
 * LSP request latency timing wrapper.
 *
 * Wraps an LSP handler function and logs a warning when the call exceeds a
 * configurable threshold. The default threshold is 50 ms; override via the
 * BGFORGE_LSP_SLOW_MS environment variable (parsed once at module load).
 *
 * The measurement itself lives in `shared/timing.ts`, which the extension host's own timing shares - this
 * module is the LSP-shaped adapter over it (handler in, wrapped handler out, tagged `lsp-timing`).
 */

import { timed } from "../../../shared/timing";

/** Default slow-request threshold in milliseconds. See docs/architecture.md#latency-budgets for per-operation targets. */
const ENV_THRESHOLD_MS = parseInt(process.env["BGFORGE_LSP_SLOW_MS"] ?? "", 10);
export const DEFAULT_THRESHOLD_MS: number = Number.isFinite(ENV_THRESHOLD_MS) ? ENV_THRESHOLD_MS : 50;

/** Minimal logger interface used by timeHandler. */
interface WarnLogger {
    warn(message: string): void;
}

/** Options accepted by timeHandler. */
interface TimeHandlerOptions {
    /** Logger providing a warn method. Defaults to connection.console when wired in server.ts. */
    warn: (message: string) => void;
    /** Log when elapsed ms exceeds this value. Defaults to DEFAULT_THRESHOLD_MS. */
    thresholdMs?: number;
}

/**
 * Wrap an LSP handler with latency logging.
 *
 * @param name     Human-readable handler name used in log messages.
 * @param fn       The handler to wrap. May be sync or async.
 * @param options  Logger and threshold configuration.
 * @returns A wrapper function with the same signature as `fn`.
 */
export function timeHandler<TArgs extends unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => TReturn,
    options: TimeHandlerOptions,
): (...args: TArgs) => TReturn {
    const { warn, thresholdMs = DEFAULT_THRESHOLD_MS } = options;

    return function (...args: TArgs): TReturn {
        return timed(name, { warn, thresholdMs, tag: "lsp-timing" }, () => fn(...args));
    };
}

/**
 * Build a timeHandler options object from an LSP connection console.
 * Convenience helper used in server.ts. The parameter is named `logger` (not
 * `console`) so the body's `logger.warn(msg)` cannot be misread as the global
 * `console.warn` - every call site passes `connection.console`, so warnings
 * route through the LSP transport, not server stderr.
 */
export function makeTimingOptions(logger: WarnLogger, thresholdMs: number = DEFAULT_THRESHOLD_MS): TimeHandlerOptions {
    return { warn: (msg) => logger.warn(msg), thresholdMs };
}
