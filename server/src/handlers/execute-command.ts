import { conlog } from "../logger";
import { COMMAND_compile, compile } from "../compile";
import { showInfo, showWarning } from "../user-messages";
import { parseDialog } from "../dialog";
import { getSSLSideEffectFunctions } from "../fallout-ssl/side-effects";
import { parseTDSource } from "../td/dialog-source";
import { parseTSSLSource } from "../tssl/dialog-source";
import { parseDDialog } from "../weidu-d/dialog";
import { getServerContext } from "../server-context";
import { EXT_TD, EXT_TSSL, LANG_FALLOUT_SSL, LANG_TYPESCRIPT, LANG_WEIDU_D } from "../core/languages";
import {
    LSP_COMMAND_PARSE_DIALOG,
    LSP_COMMAND_SAVE_TRA,
    LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX,
    VSCODE_COMMAND_COMPILE,
} from "../../../shared/protocol";
import { registry } from "../provider-registry";
import { handleCompileError } from "./compile-error";
import type { HandlerContext } from "./context";

/** Dialog preview handler registry. Maps language/extension to parser + translation language. */
const dialogHandlers = [
    {
        match: (langId: string, _uri: string) => langId === LANG_FALLOUT_SSL,
        parse: (_uri: string, text: string) => parseDialog(text, getSSLSideEffectFunctions()),
        translationLangId: LANG_FALLOUT_SSL,
    },
    {
        match: (langId: string, _uri: string) => langId === LANG_WEIDU_D,
        parse: (_uri: string, text: string) => Promise.resolve(parseDDialog(text)),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TD),
        // Source-native parse (ranges into the .td), not transpile-then-parse - so edits round-trip to source.
        parse: (_uri: string, text: string) => Promise.resolve(parseTDSource(text)),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TSSL),
        parse: (_uri: string, text: string) => Promise.resolve(parseTSSLSource(text, getSSLSideEffectFunctions())),
        translationLangId: LANG_FALLOUT_SSL,
    },
];

export function register(ctx: HandlerContext): void {
    ctx.connection.onExecuteCommand(async (params, token) => {
        const command = params.command;

        // Per-language scoped workspace-symbol search.
        // Standard `workspace/symbol` returns aggregated results from every provider;
        // this command lets clients restrict results to one language for polyglot
        // workspaces. Argument shape: `{ query: string }`.
        if (command.startsWith(LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX)) {
            const languageId = command.slice(LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX.length);
            const arg = params.arguments?.[0];
            const query = typeof arg?.query === "string" ? arg.query : "";
            return registry.workspaceSymbols(query, token, languageId);
        }

        if (!params.arguments) {
            return;
        }
        const args = params.arguments[0];

        // Handle parseDialog command
        if (command === LSP_COMMAND_PARSE_DIALOG) {
            // Validate the webview-supplied uri like the compile branch below (args[0] may be absent, and
            // reading `.uri` off it would throw). No user-facing message - this is an internal editor command,
            // not a user-invoked one, so a bad uri is a programming error to log, not to surface.
            if (typeof args?.uri !== "string") {
                conlog(`parseDialog: invalid uri '${String(args?.uri)}'`, "warn");
                return null;
            }
            const uri: string = args.uri;
            const textDoc = ctx.documents.get(uri);
            if (!textDoc) {
                conlog(`parseDialog: NO open document for ${uri} (not synced to the server)`, "warn");
                return null;
            }
            try {
                const langId = textDoc.languageId;
                const text = textDoc.getText();
                const lowerUri = uri.toLowerCase();

                const handler = dialogHandlers.find((h) => h.match(langId, lowerUri));
                if (!handler) {
                    conlog(`parseDialog: NO handler for languageId='${langId}'`, "warn");
                    return null;
                }
                const dialogData = await handler.parse(uri, text);
                const serverCtx = await getServerContext();
                const messages = serverCtx.translation.getMessages(uri, text, handler.translationLangId);
                return { ...dialogData, messages };
            } catch (error) {
                conlog(`parseDialog error: ${error instanceof Error ? error.message : String(error)}`, "error");
                if (error instanceof Error && error.stack) {
                    conlog(error.stack, "debug");
                }
                return null;
            }
        }

        // Persist edited @N dialogue strings to the resolved .tra (dialog editor save).
        if (command === LSP_COMMAND_SAVE_TRA) {
            if (typeof args?.uri !== "string") {
                conlog(`saveTra: invalid uri '${String(args?.uri)}'`, "warn");
                return null;
            }
            const uri: string = args.uri;
            const messages = args.messages as Record<string, string> | undefined;
            const textDoc = ctx.documents.get(uri);
            if (!textDoc || !messages) {
                return null;
            }
            const handler = dialogHandlers.find((h) => h.match(textDoc.languageId, uri.toLowerCase()));
            const translationLangId = handler?.translationLangId ?? LANG_WEIDU_D;
            const serverCtx = await getServerContext();
            const result = serverCtx.translation.writeMessages(uri, textDoc.getText(), translationLangId, messages);
            // An @N edit rewrites only the active language's .tra. If sibling-language .tra
            // files exist, they now hold the old text - warn rather than diverge silently.
            if (result.staleSiblingLanguages.length > 0) {
                showWarning(
                    `Saved @N translation edits to the active language only. These other language(s) ` +
                        `still have the previous text and need updating: ${result.staleSiblingLanguages.join(", ")}.`,
                );
            }
            return { changed: result.changed };
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

        void compile(uri, langId, true, text).catch((error) => handleCompileError(error, true));
        // eslint-disable-next-line unicorn/no-useless-undefined -- TS noImplicitReturns flags the implicit-undefined path
        return undefined;
    });
}
