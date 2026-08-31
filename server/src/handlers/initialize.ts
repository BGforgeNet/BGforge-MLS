import { fileURLToPath } from "node:url";
import {
    type InitializeParams,
    type InitializeResult,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
} from "vscode-languageserver/node";
import { conlog } from "../logger";
import {
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SCRIPTS_LST,
    LANG_FALLOUT_SSL,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TRA,
    LANG_WEIDU_TP2,
} from "../core/languages";
import { parserManager, setParserLogger } from "../../../shared/parsers/parser-manager";
import { registry } from "../provider-registry";
import * as settings from "../settings";
import { defaultSettings, normalizeSettings } from "../settings";
import { falloutSslProvider } from "../fallout-ssl/provider";
import { falloutWorldmapProvider } from "../fallout-worldmap/provider";
import { weiduBafProvider } from "../weidu-baf/provider";
import { weiduDProvider } from "../weidu-d/provider";
import { weiduTp2Provider } from "../weidu-tp2/provider";
import { infinity2daProvider } from "../infinity-2da/provider";
import { createFormatOnlyProvider } from "../core/format-only-provider";
import { formatTra, formatMsg, formatScriptsLst } from "@bgforge/format";
import { weiduLogProvider } from "../weidu-log/provider";
import { Translation } from "../translation";
import { initServerContext, updateServerSettings } from "../server-context";
import { ConfiguredGame } from "../ie-resources/configured-game";
import { getServerCapabilities } from "../server-capabilities";
import { fireRefresh } from "../shared/lsp-refresh";
import type { HandlerContext } from "./context";

// Capability flags captured in onInitialize, consumed in onInitialized.
// Plain object so both handlers share a reference without module-level lets.
const capabilityFlags = {
    configuration: false,
    workspaceFolders: false,
    fileWatching: false,
};

// Workspace root captured in onInitialize, consumed in onInitialized.
let workspaceRoot: string | undefined;

// The initial translation load, started in onInitialize and picked up in onInitialized - same reason as
// the flags above, the two handlers are separate closures. Resolved by default so a client that never
// sends `initialize` (or an onInitialized without one) has nothing to await.
let translationLoad: Promise<void> = Promise.resolve();

export function register(ctx: HandlerContext): void {
    ctx.connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
        conlog("onInitialize started");
        const caps = params.capabilities;
        // Does the client support the `workspace/configuration` request?
        // If not, we fall back using global settings.
        capabilityFlags.configuration = Boolean(caps.workspace?.configuration);
        capabilityFlags.workspaceFolders = Boolean(caps.workspace?.workspaceFolders);
        capabilityFlags.fileWatching = Boolean(caps.workspace?.didChangeWatchedFiles?.dynamicRegistration);

        if (params.workspaceFolders?.[0]) {
            workspaceRoot = fileURLToPath(params.workspaceFolders[0].uri);
            conlog(`workspace_root = ${workspaceRoot}`);
        }

        // Load data and initialize parsers/providers here so the server can answer
        // requests the moment the initialize response is sent. This closes the race
        // window where onInitialized's async setup had not yet finished but the client
        // was already firing requests (e.g. textDocument/inlayHint). The workspace
        // SCAN is the deliberate exception: registry.init() backgrounds it, so early
        // requests see a partially populated index instead of a stalled handshake.
        const projectSettings = settings.project(workspaceRoot);

        // Initialize translation service. The refresh callback lets a .tra/.msg reload push
        // open consumer documents' stale inlay @N previews to be recomputed - see
        // Translation.reloadFileLines, which fires it after re-indexing a translation file.
        const translation = new Translation(projectSettings.translation, workspaceRoot, () => {
            fireRefresh(() => ctx.connection.languages.inlayHint.refresh());
        });
        // Not awaited: this is ~700 ms of a ~750 ms handshake, and the client cannot send a request until
        // the initialize response goes out. The provider scan is held behind it (`scanAfter` below), so the
        // load still lands at its old wall-clock time instead of being starved behind the workspace parse -
        // backgrounding it alone pushed `@N` previews from ~750 ms out to ~5.3 s.
        //
        // The re-apply is chained on because every Translation method returns early while `initialized` is
        // false: a document opened during the load had its onDidOpen pair dropped, and the load replaces
        // state.data wholesale. The catch belongs here rather than on the onInitialized consumer - a client
        // that never sends `initialized` would leave the rejection unhandled, which ends the process.
        translationLoad = translation
            .init()
            .then(() => {
                // Both calls, not just reloadFile as before: every Translation method returns early while
                // `initialized` is false, so a document the client opened during the load had its own
                // onDidOpen pair dropped, and this is the only place that puts either back.
                for (const document of ctx.documents.all()) {
                    const text = document.getText();
                    translation.reloadFile(document.uri, document.languageId, text);
                    translation.reloadConsumer(document.uri, text, document.languageId);
                }
            })
            .catch((error) => conlog(`Translation load failed: ${error}`, "error"));

        // Route parser-init log lines through the LSP connection so they surface
        // in the client's Output panel (the default console.error sink would lose
        // them inside the language-server stdio stream).
        setParserLogger({
            info: (message) => conlog(message),
            error: (message) => conlog(message, "error"),
        });

        // Register tree-sitter parsers and initialize them sequentially
        // (web-tree-sitter's shared TRANSFER_BUFFER requires sequential Language.load())
        parserManager.register(LANG_FALLOUT_SSL, "tree-sitter-ssl.wasm", "SSL");
        parserManager.register(LANG_WEIDU_BAF, "tree-sitter-baf.wasm", "BAF");
        parserManager.register(LANG_WEIDU_D, "tree-sitter-weidu_d.wasm", "WeiDU D");
        parserManager.register(LANG_WEIDU_TP2, "tree-sitter-weidu_tp2.wasm", "WeiDU TP2");
        // MSG/TRA have no full LSP provider - they register a parser solely so
        // tree-sitter parse errors surface as diagnostics (gated by bgforge.diagnostics).
        parserManager.register(LANG_FALLOUT_MSG, "tree-sitter-fallout_msg.wasm", "Fallout MSG");
        parserManager.register(LANG_WEIDU_TRA, "tree-sitter-weidu_tra.wasm", "WeiDU TRA");
        await parserManager.initAll();

        // Register and initialize providers
        registry.register(falloutSslProvider);
        registry.register(falloutWorldmapProvider);
        registry.register(weiduBafProvider);
        registry.register(weiduDProvider);
        registry.register(weiduTp2Provider);
        registry.register(weiduLogProvider);
        registry.register(infinity2daProvider);
        registry.register(createFormatOnlyProvider(LANG_WEIDU_TRA, formatTra, "tra"));
        registry.register(createFormatOnlyProvider(LANG_FALLOUT_MSG, formatMsg, "msg"));
        registry.register(createFormatOnlyProvider(LANG_FALLOUT_SCRIPTS_LST, formatScriptsLst));

        // Register language aliases (languages that share data with parent providers)
        registry.registerAlias(LANG_WEIDU_SLB, LANG_WEIDU_BAF);
        registry.registerAlias(LANG_WEIDU_SSL, LANG_WEIDU_BAF);

        await registry.init({
            workspaceRoot,
            settings: defaultSettings,
            getDocumentText: (uri) => ctx.documents.get(uri)?.getText(),
            getDocumentVersion: (uri) => ctx.documents.get(uri)?.version,
            getTranslationDir: () => translation.directory(),
            scanAfter: translationLoad,
        });

        initServerContext({
            capabilities: {
                configuration: capabilityFlags.configuration,
                workspaceFolders: capabilityFlags.workspaceFolders,
                fileWatching: capabilityFlags.fileWatching,
            },
            workspaceRoot,
            projectSettings,
            settings: defaultSettings,
            translation,
            configuredGame: new ConfiguredGame(),
        });

        const result: InitializeResult = {
            capabilities: getServerCapabilities(),
        };
        if (capabilityFlags.workspaceFolders) {
            result.capabilities.workspace = {
                workspaceFolders: {
                    supported: true,
                },
            };
        }
        conlog("onInitialize completed");
        return result;
    });

    ctx.connection.onInitialized(async () => {
        conlog("onInitialized started");
        if (capabilityFlags.configuration) {
            // Register for all configuration changes.
            await ctx.connection.client.register(DidChangeConfigurationNotification.type);
        }

        // Fetch the real user settings now that the client is ready to respond,
        // and push them to both the context and the provider registry.
        const freshSettings = normalizeSettings(
            await ctx.connection.workspace.getConfiguration({ section: "bgforge" }),
        );
        updateServerSettings(freshSettings);
        registry.updateSettings(freshSettings);

        // Register file watchers for header files
        // NOTE: For standalone LSP usage (e.g., Claude Code) where client may not support
        // file watching, consider adding chokidar-based fallback in the future.
        if (capabilityFlags.fileWatching) {
            const watchPatterns = registry.getWatchPatterns();
            if (watchPatterns.length > 0) {
                await ctx.connection.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: watchPatterns,
                });
                conlog(`Registered file watchers for ${watchPatterns.length} patterns`);
            }
        } else if (registry.getWatchPatterns().length > 0) {
            conlog(
                "Client did not advertise didChangeWatchedFiles dynamicRegistration; " +
                    "header reload on out-of-band edit is disabled.",
                "warn",
            );
        }

        // Ask the client to re-pull inlay hints once the translation load lands. It is fired from here,
        // not from the load's own continuation, because a server->client request is only legal after the
        // client has the initialize response - and on a workspace with no tra directory the load resolves
        // within the handshake, so that continuation can run before the response goes out.
        void translationLoad.then(() => fireRefresh(() => ctx.connection.languages.inlayHint.refresh()));

        conlog("onInitialized completed");
    });
}
