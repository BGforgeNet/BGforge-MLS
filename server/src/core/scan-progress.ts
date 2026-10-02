/**
 * The startup scan's progress as LSP work-done progress, the client's own "indexing" indicator.
 *
 * Server-initiated progress is a request, and LSP allows none before the client says `initialized` - while the
 * scan may start ahead of that. So the indicator attaches when `initialized` arrives, beginning at the count
 * reached by then, and a scan already finished by that point shows none. A client that does not support the
 * progress gets a reporter that does nothing, from the connection itself.
 */

import type { Connection, WorkDoneProgressServerReporter } from "vscode-languageserver/node";
import { errorMessage } from "../diagnostics";
import { conlog } from "../logger";
import type { ScanProgress } from "./workspace-scanner";

const TITLE = "Indexing workspace";

// Zero with no total: before the file list is in, and a scan of nothing ends without another report.
const percentOf = (done: number, total: number): number => (total === 0 ? 0 : Math.floor((done * 100) / total));
const countOf = (done: number, total: number): string | undefined =>
    total === 0 ? undefined : `${done}/${total} files`;

export function workDoneScanProgress(connection: Connection, initialized: Promise<void>): ScanProgress {
    let reporter: WorkDoneProgressServerReporter | undefined;
    let finished = false;
    let latest = { done: 0, total: 0 };
    let lastPercent = -1;

    initialized
        .then(async () => {
            if (finished) return;
            const created = await connection.window.createWorkDoneProgress();
            lastPercent = percentOf(latest.done, latest.total);
            created.begin(TITLE, lastPercent, countOf(latest.done, latest.total), false);
            if (finished) created.done();
            else reporter = created;
        })
        .catch((error: unknown) => conlog(`Workspace scan progress unavailable: ${errorMessage(error)}`, "warn"));

    return {
        report(done, total) {
            latest = { done, total };
            const percent = percentOf(done, total);
            // One message per percent, not per file: a large mod has thousands.
            if (reporter === undefined || total === 0 || percent === lastPercent) return;
            lastPercent = percent;
            reporter.report(percent, `${done}/${total} files`);
        },
        done() {
            finished = true;
            reporter?.done();
        },
    };
}
