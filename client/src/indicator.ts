import * as vscode from "vscode";
import { Disposable } from "vscode";

/**
 * Default timeout (ms) after which a stuck progress task auto-resolves.
 * Server initialization completes in seconds in normal use; this guards
 * against the spinner persisting indefinitely if the server crashes
 * before sending its LOAD_FINISHED notification.
 */
export const DEFAULT_INDICATOR_TIMEOUT_MS = 60_000;

export class ServerInitializingIndicator extends Disposable {
    private _task?: { project: string | undefined; resolve: () => void; timer: ReturnType<typeof setTimeout> };
    private readonly _timeoutMs: number;

    /**
     * @param timeoutMs Maximum time the spinner stays visible without a
     *   matching `finishedLoadingProject`. Override for tests; defaults to
     *   {@link DEFAULT_INDICATOR_TIMEOUT_MS}.
     */
    public constructor(timeoutMs: number = DEFAULT_INDICATOR_TIMEOUT_MS) {
        super(() => {
            this.reset();
        });
        this._timeoutMs = timeoutMs;
    }

    public reset(): void {
        if (this._task) {
            clearTimeout(this._task.timer);
            this._task.resolve();
            this._task = undefined;
        }
    }

    /**
     * Signal that a project has started loading.
     */
    public startedLoadingProject(projectName: string | undefined): void {
        // TS projects are loaded sequentially. Cancel existing task because it should always be resolved before
        // the incoming project loading task is.
        this.reset();

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: vscode.l10n.t("BGforge MLS: initializing project"),
            },
            () =>
                new Promise<void>((resolve) => {
                    const timer = setTimeout(() => {
                        if (this._task && this._task.timer === timer) {
                            this._task.resolve();
                            this._task = undefined;
                        }
                    }, this._timeoutMs);
                    this._task = { project: projectName, resolve, timer };
                }),
        );
    }

    public finishedLoadingProject(projectName: string | undefined): void {
        if (this._task && this._task.project === projectName) {
            clearTimeout(this._task.timer);
            this._task.resolve();
            this._task = undefined;
        }
    }
}
