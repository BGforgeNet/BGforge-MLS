/**
 * Which compiled formats open as source, and what each one reads as.
 *
 * One table, because every other part of the feature is derived from it: the editor claims these extensions,
 * the game-resource tree routes them here, the language client attaches to the view scheme for these
 * languages, and the compile command recognises their documents. A format added here is served by all of
 * them; a format known to only some of them is the shape this table exists to prevent.
 *
 * Deliberately free of `vscode` imports so the derivations above stay testable without the registration
 * machinery around them - the same reason `ie-resources/editor-routing.ts` is its own module.
 */

import { LANG_FALLOUT_SSL, LANG_WEIDU_BAF } from "../../../shared/languages";

/** The custom URI scheme every compiled script is served on, whatever it decompiles into. */
export const SCRIPT_VIEW_SCHEME = "bgforge-script";

/** The custom editor that redirects a compiled file to its source view. */
export const SCRIPT_EDITOR_VIEW_TYPE = "bgforge.scriptEditor";

/**
 * Which renderer and compiler a format is served by. Formats sharing a kind share an implementation whole -
 * `.bs` is a `.bcs` under another name - so adding one is a row here and nothing else. A format needing its
 * own pair adds a kind, and the exhaustive switch that builds the views stops compiling until it has one.
 */
export type ScriptFormatKind = "fallout-int" | "infinity-bcs";

export interface ScriptFormat {
    /** Source extension, lowercase and without the dot. */
    readonly ext: string;
    /** The language the view document is opened as. */
    readonly language: string;
    /**
     * Appended to the source's path to name the view document, so the tab reads as source and every language
     * feature keyed on the extension applies.
     */
    readonly viewSuffix: string;
    readonly kind: ScriptFormatKind;
}

export const SCRIPT_FORMATS: readonly ScriptFormat[] = [
    { ext: "int", language: LANG_FALLOUT_SSL, viewSuffix: ".ssl", kind: "fallout-int" },
    { ext: "bcs", language: LANG_WEIDU_BAF, viewSuffix: ".baf", kind: "infinity-bcs" },
    // The AI-selection scripts an Infinity Engine game ships beside its area and creature scripts. Same
    // format, same tables, different extension.
    { ext: "bs", language: LANG_WEIDU_BAF, viewSuffix: ".baf", kind: "infinity-bcs" },
];

/** The extension of a path, lowercased and without the dot; empty when it has none. */
function extensionOf(uriPath: string): string {
    const name = uriPath.slice(uriPath.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The format an extension names, or undefined when it names none. */
export function scriptFormatForExtension(ext: string): ScriptFormat | undefined {
    const wanted = ext.replace(/^\./, "").toLowerCase();
    return SCRIPT_FORMATS.find((format) => format.ext === wanted);
}

/**
 * The format a source URI holds, or undefined when it holds none.
 *
 * Takes the path rather than a `vscode.Uri` so this module needs no vscode: both sides of the view URI carry
 * one, and a source is identified by its extension either way.
 */
export function scriptFormatForPath(uriPath: string): ScriptFormat | undefined {
    return scriptFormatForExtension(extensionOf(uriPath));
}
