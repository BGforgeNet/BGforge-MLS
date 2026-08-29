/**
 * Latency reporting for extension-host work.
 *
 * The host thread is shared with the whole VS Code UI, so anything synchronous and proportional to the
 * user's data - parsing a game's resource index, walking an install - freezes the editor while it runs.
 * The LSP server has reported its own slow requests for a while (`server/src/shared/time-handler.ts`);
 * this is that reporting for the surface where a stall is most visible and where there was none.
 *
 * Wrap the operation, don't sprinkle timers: a report that only fires over budget stays silent in normal
 * use and names the operation when it does not.
 */

import { timed } from "../../shared/timing";
import { conlog } from "./logging";

/**
 * How long host work may hold the thread before it is reported. Matches the LSP server's per-request
 * budget: past this the user is waiting on something, and it should be attributable rather than folklore.
 */
export const HOST_SLOW_MS = 50;

/** Run `work` on the host, reporting to the output channel when it holds the thread past the budget. */
export function timedHost<T>(name: string, work: () => T): T {
    return timed(
        name,
        { warn: (message) => conlog(message, "warn"), thresholdMs: HOST_SLOW_MS, tag: "host-timing" },
        work,
    );
}
