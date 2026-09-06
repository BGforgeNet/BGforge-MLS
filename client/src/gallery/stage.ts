/**
 * The animation surface inside the gallery panel.
 *
 * The panel does not draw an animation of its own: it opens the same document the editor tab opens and
 * hands it to the same protocol handler, so the picture, its controls, its save and its conversion are
 * one implementation shown in two places. What this module holds is the part that is genuinely the
 * panel's: which document is currently on the stage, and swapping it for another without a new tab.
 */
import * as vscode from "vscode";
import type { ImageEditorDocument } from "../image-editor/document";
import type { AnimationChannel, AnimationSurface } from "../image-editor/provider";
import type {
    HostToWebview as AnimationHostToWebview,
    WebviewToHost as AnimationWebviewToHost,
} from "../image-editor/webview/messages";

/**
 * The animation editor, as the gallery uses it.
 *
 * Structural rather than the provider's own type: the panel needs three of its capabilities, and naming
 * them is what keeps a test able to stand the stage up without a custom editor behind it.
 */
export interface AnimationStageHost {
    openDocument(uri: vscode.Uri): Promise<ImageEditorDocument>;
    attach(document: ImageEditorDocument, channel: AnimationChannel, surface: AnimationSurface): vscode.Disposable;
    saveDocument(document: ImageEditorDocument): Promise<void>;
}

export interface AnimationStageDeps {
    host: AnimationStageHost;
    /** Post one of the animation protocol's messages down to the panel's webview. */
    post(message: AnimationHostToWebview): void;
    /**
     * Show a set on this panel, by id.
     *
     * The panel's own move rather than the stage's: it also says which row is now current, which is state
     * the stage does not hold.
     */
    showSet(gameDir: string, id: number): Promise<void>;
}

export interface AnimationStage {
    /**
     * Put this document on the stage, replacing whatever was there.
     *
     * False when a later `show` overtook this one - opening reads files, so two quick picks are two reads
     * in flight, and the slower one must not land on the stage after the reader has moved on.
     */
    show(uri: vscode.Uri): Promise<boolean>;
    /** Hand the surface one of its own messages, arriving wrapped in the panel's protocol. */
    receive(message: AnimationWebviewToHost): void;
    dispose(): void;
}

export function createAnimationStage(deps: AnimationStageDeps): AnimationStage {
    /**
     * The attached handler, or undefined with nothing on the stage.
     *
     * A field rather than a subscription list: exactly one document is shown at a time, so a message
     * arriving between two shows belongs to neither and is dropped rather than delivered to the wrong one.
     */
    let deliver: ((message: AnimationWebviewToHost) => Promise<void>) | undefined;
    let attached: vscode.Disposable | undefined;
    /** Kept only to dispose it: a document owns event emitters, and the panel opens one per selection. */
    let shown: ImageEditorDocument | undefined;
    /** Counts shows, so a read that finishes after a later one can tell it has been overtaken. */
    let generation = 0;

    const clear = (): void => {
        attached?.dispose();
        attached = undefined;
        shown?.dispose();
        shown = undefined;
    };

    const channel: AnimationChannel = {
        post: deps.post,
        onMessage: (handler) => {
            deliver = handler;
            return new vscode.Disposable(() => {
                if (deliver === handler) deliver = undefined;
            });
        },
    };

    const surface: AnimationSurface = {
        // The panel is not a document, so there is no dirty state for VS Code to clear - the write itself
        // is the whole save, through the same path the tab's save reaches.
        save: (document) => deps.host.saveDocument(document),
        showSet: (gameDir, id) => deps.showSet(gameDir, id),
    };

    return {
        async show(uri: vscode.Uri): Promise<boolean> {
            const mine = ++generation;
            // Cleared BEFORE the open: opening reads files, and a message answered in the meantime would
            // be answered against the document being replaced.
            clear();
            const document = await deps.host.openDocument(uri);
            if (mine !== generation) {
                // Overtaken while reading. Disposed rather than shown: the reader has picked something else,
                // and this one is now a document nothing will ever draw.
                document.dispose();
                return false;
            }
            shown = document;
            attached = deps.host.attach(document, channel, surface);
            return true;
        },
        receive(message: AnimationWebviewToHost): void {
            // Nothing to await it here - the handler reports its own failures back down the channel, which
            // is the whole error path this surface has.
            void deliver?.(message);
        },
        dispose(): void {
            clear();
        },
    };
}
