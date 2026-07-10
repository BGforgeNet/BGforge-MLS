/**
 * In-memory host for the round-trip harness driver (edit-roundtrip.mts): the REAL DialogHostCore
 * (the session logic panel.ts runs in production) bound to an in-memory document and .tra instead
 * of the VS Code runtime and the LSP server. Parsing goes through the real server-side D parser,
 * splicing through the real computeDialogSourceEdit (inside the core), and the .tra write mirrors
 * the server's - so the emit -> splice -> reparse -> adopt -> flush protocol runs whole
 * under automated tests, which no other tier covers (the render drivers have no host at all).
 */

import { DialogHostCore, type DialogHostIO } from "../../host-core";
import { initParser } from "../../../../../shared/parsers/weidu-d";
import { parseDDialog } from "../../../../../server/src/weidu-d/dialog";
import { appendTraEntries, rewriteTraEntries } from "../../../../../shared/dialog-tra-edit";
import { modelFromD, type DialogMessages, type DialogModel } from "../../../../../shared/dialog-model";
import { parseTra } from "./driver-util";

export interface FakeHost {
    core: DialogHostCore;
    /** The in-memory dialog source document (what a WorkspaceEdit would splice in production). */
    doc: { text: string };
    /** The in-memory .tra the debounced message flush writes through to. */
    tra: { text: string };
    /** Every showError surfaced by the core - a clean run ends with this empty. */
    errors: string[];
    /** Every message the core posted to the webview (model/reparse/error), for protocol assertions. */
    posted: unknown[];
}

export async function createFakeHost(opts: {
    documentPath: string;
    docText: string;
    traText: string;
    /** Deliver a host->webview message into the page (window.postMessage in the driver). */
    postToWebview: (msg: unknown) => void;
}): Promise<FakeHost> {
    await initParser();
    const doc = { text: opts.docText };
    const tra = { text: opts.traText };
    const errors: string[] = [];
    const posted: unknown[] = [];
    const io: DialogHostIO = {
        getText: () => doc.text,
        // Mirrors the LSP_COMMAND_PARSE_DIALOG D arm (server/src/handlers/execute-command.ts): the parsed
        // dialog data plus the resolved messages. The harness joins the in-memory .tra directly instead of
        // running the server's Translation resolution, which needs a workspace it does not have here.
        requestParse: async () => ({ data: { ...parseDDialog(doc.text), messages: parseTra(tra.text) } }),
        replaceText: async (newText) => {
            doc.text = newText;
            return true;
        },
        postToWebview: (msg) => {
            posted.push(msg);
            opts.postToWebview(msg);
        },
        showError: (message) => {
            errors.push(message);
        },
        // Mirrors the .tra arm of Translation.writeMessages (server/src/translation.ts): rewrite the
        // entries that exist, then append the newly-minted ids.
        saveMessages: async (messages: DialogMessages) => {
            tra.text = appendTraEntries(rewriteTraEntries(tra.text, messages), messages);
        },
    };
    return { core: new DialogHostCore(io, opts.documentPath), doc, tra, errors, posted };
}

/**
 * The DialogModel a plain (non-reparse) host post would carry for the CURRENT in-memory document - what
 * the production host sends on an external text-side edit. `sourceName` must match the open model's for
 * the webview's same-file adopt branch to engage (the core derives it from the document path).
 */
export function currentModel(host: FakeHost, sourceName: string): DialogModel {
    const model = { ...modelFromD(parseDDialog(host.doc.text)), sourceLang: "d" as const };
    model.messages = { ...model.messages, ...parseTra(host.tra.text) };
    model.sourceName = sourceName;
    return model;
}
