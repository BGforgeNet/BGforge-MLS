/**
 * Which documents the language client attaches to.
 *
 * Its own module so the list is testable without the vscode-heavy activation around it. A document the client
 * does not select keeps its TextMate highlighting and loses everything the server provides - completion,
 * hover, outline, signature help - so the tab looks right and reads as the server being broken.
 *
 * Derived rather than listed, on both axes that were getting missed. A language is selected on every scheme a
 * document of ours can arrive on, not `file:` alone; and the decompiled-script scheme is selected for exactly
 * the languages the format registry names, so a format added there is served here with no second edit.
 */

import type { TextDocumentFilter } from "vscode-languageclient/node";
import {
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SCRIPTS_LST,
    LANG_FALLOUT_SSL,
    LANG_FALLOUT_WORLDMAP_TXT,
    LANG_INFINITY_2DA,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_LOG,
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TP2,
    LANG_WEIDU_TRA,
} from "../../shared/languages";
import { GAME_RESOURCE_SCHEME } from "./ie-resources/uri";
import { SCRIPT_FORMATS, SCRIPT_VIEW_SCHEME } from "./script-view/formats";

/**
 * The languages this extension's server answers for.
 *
 * Named from the shared registry the server and the format package read, so client and server cannot disagree
 * about an id; the guard test then holds this list against the manifest's `onLanguage:` activation events,
 * which is the other copy of it. The transpiler sources are absent because they are TypeScript documents:
 * their language id says nothing about which of them a file is, so they are selected by pattern below.
 */
const LANGUAGES: readonly string[] = [
    LANG_INFINITY_2DA,
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SCRIPTS_LST,
    LANG_FALLOUT_SSL,
    LANG_FALLOUT_WORLDMAP_TXT,
    LANG_WEIDU_TP2,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_SSL,
    LANG_WEIDU_SLB,
    LANG_WEIDU_TRA,
    LANG_WEIDU_LOG,
];

/**
 * Schemes a document carrying one of those languages can arrive on.
 *
 * A game archive serves its resources as text on its own scheme, so a `.2da` opened from the resource tree is
 * an `infinity-2da` document that never touches disk, and selecting `file:` alone gave those tabs highlighting
 * and nothing else. A pair that cannot occur - a game holds no `.tra` - costs nothing, since the filter simply
 * never matches; a missing one costs the feature.
 */
const LANGUAGE_SCHEMES: readonly string[] = ["file", GAME_RESOURCE_SCHEME];

export const LSP_DOCUMENT_SELECTOR: TextDocumentFilter[] = [
    ...LANGUAGES.flatMap((language) => LANGUAGE_SCHEMES.map((scheme) => ({ scheme, language }))),
    // The decompiled-script view: each format's source language, on the one scheme every format is served on.
    // Compiling one is refused server-side - the URI names no file to write output beside - and the view
    // compiles it back on save instead.
    ...[...new Set(SCRIPT_FORMATS.map((format) => format.language))].map((language) => ({
        scheme: SCRIPT_VIEW_SCHEME,
        language,
    })),
    { scheme: "file", pattern: "**/*.tbaf" },
    { scheme: "file", pattern: "**/*.tssl" },
    { scheme: "file", pattern: "**/*.td" },
];
