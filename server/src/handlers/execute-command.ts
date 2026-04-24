import { conlog } from "../common";
import { COMMAND_compile, compile } from "../compile";
import { showInfo } from "../user-messages";
import { parseDialog } from "../dialog";
import { parseTDDialog } from "../td/dialog";
import { parseTSSLDialog } from "../tssl/dialog";
import { parseDDialog } from "../weidu-d/dialog";
import { getServerContext } from "../server-context";
import {
    EXT_TD,
    EXT_TSSL,
    LANG_FALLOUT_SSL,
    LANG_TYPESCRIPT,
    LANG_WEIDU_D,
} from "../core/languages";
import { LSP_COMMAND_PARSE_DIALOG, VSCODE_COMMAND_COMPILE } from "../../../shared/protocol";
import type { HandlerContext } from "./context";

/** Dialog preview handler registry. Maps language/extension to parser + translation language. */
const dialogHandlers = [
    {
        match: (langId: string, _uri: string) => langId === LANG_FALLOUT_SSL,
        parse: (_uri: string, text: string) => parseDialog(text),
        translationLangId: LANG_FALLOUT_SSL,
    },
    {
        match: (langId: string, _uri: string) => langId === LANG_WEIDU_D,
        parse: (_uri: string, text: string) => Promise.resolve(parseDDialog(text)),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TD),
        parse: (uri: string, text: string) => parseTDDialog(uri, text),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TSSL),
        parse: (uri: string, text: string) => parseTSSLDialog(uri, text),
        translationLangId: LANG_FALLOUT_SSL,
    },
];

function logCompileError(err: unknown) {
    conlog(`Compilation error: ${err}`);
}

export function register(ctx: HandlerContext): void {
    ctx.connection.onExecuteCommand(async (params) => {
        const command = params.command;
        if (!params.arguments) {
            return;
        }
        const args = params.arguments[0];

        // Handle parseDialog command
        if (command === LSP_COMMAND_PARSE_DIALOG) {
            const uri: string = args.uri;
            const textDoc = ctx.documents.get(uri);
            if (!textDoc) {
                return null;
            }
            try {
                const langId = textDoc.languageId;
                const text = textDoc.getText();
                const lowerUri = uri.toLowerCase();

                const handler = dialogHandlers.find((h) => h.match(langId, lowerUri));
                if (!handler) {
                    return null;
                }
                const dialogData = await handler.parse(uri, text);
                const serverCtx = await getServerContext();
                const messages = serverCtx.translation.getMessages(uri, text, handler.translationLangId);
                return { ...dialogData, messages };
            } catch (e) {
                conlog(`parseDialog error: ${e instanceof Error ? e.message : String(e)}`, "error");
                if (e instanceof Error && e.stack) {
                    conlog(e.stack, "debug");
                }
                return null;
            }
        }

        if (command !== COMMAND_compile && command !== VSCODE_COMMAND_COMPILE) {
            return;
        }

        const uri = typeof args.uri === "string" ? args.uri : undefined;
        if (!uri || !uri.startsWith("file://")) {
            conlog(`Compile: invalid non-file uri '${String(uri)}'`);
            showInfo("Focus a valid file to run commands!");
            return;
        }

        const textDoc = ctx.documents.get(uri);
        if (!textDoc) {
            return;
        }
        const langId = textDoc.languageId;
        const text = textDoc.getText();

        void compile(uri, langId, true, text).catch(logCompileError);
        return undefined;
    });
}
