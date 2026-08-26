/**
 * Which documents the language client attaches to.
 *
 * Its own module so the list is testable without the vscode-heavy activation around it. A scheme missing here
 * costs that view every server-side feature - completion, hover, outline, signature help - while leaving its
 * TextMate highlighting untouched, so the tab looks right and reads as the server being broken.
 */

import type { DocumentFilter } from "vscode-languageclient/node";
import { BCS_SCHEME } from "./bcs-editor/document";
import { INT_SCHEME } from "./int-editor/document";

export const LSP_DOCUMENT_SELECTOR: DocumentFilter[] = [
    { scheme: "file", language: "infinity-2da" },

    { scheme: "file", language: "fallout-msg" },
    { scheme: "file", language: "fallout-scripts-lst" },
    { scheme: "file", language: "fallout-ssl" },
    // A decompiled `.int`, which is Fallout SSL on its own scheme rather than on disk. Without
    // this the language client never attaches and the tab has highlighting but no completion,
    // hover or outline - the parts that come from the server rather than from the grammar.
    // Compiling one is refused server-side: the URI names no file to write output beside.
    { scheme: INT_SCHEME, language: "fallout-ssl" },
    { scheme: "file", language: "fallout-worldmap-txt" },

    { scheme: "file", language: "weidu-tp2" },

    { scheme: "file", language: "weidu-baf" },
    // A decompiled `.bcs`, which is BAF on its own scheme, for the same reason as the `.int` view above.
    { scheme: BCS_SCHEME, language: "weidu-baf" },

    { scheme: "file", language: "weidu-d" },

    { scheme: "file", language: "weidu-ssl" },
    { scheme: "file", language: "weidu-slb" },

    { scheme: "file", language: "weidu-tra" },

    { scheme: "file", language: "weidu-log" },

    { scheme: "file", pattern: "**/*.tbaf" },
    { scheme: "file", pattern: "**/*.tssl" },
    { scheme: "file", pattern: "**/*.td" },
];
