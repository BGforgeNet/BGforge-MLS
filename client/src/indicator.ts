import * as vscode from "vscode";
import { Disposable } from "vscode";

export class ServerInitializingIndicator extends Disposable {
    private _task?: { project: string | undefined; resolve: () => void };

    public reset(): void {
        if (this._task) {
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
                    this._task = { project: projectName, resolve };
                }),
        );
    }

    public finishedLoadingProject(projectName: string | undefined): void {
        if (this._task && this._task.project === projectName) {
            this._task.resolve();
            this._task = undefined;
        }
    }
}
