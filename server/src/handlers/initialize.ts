import { fileURLToPath } from "node:url";
import {
    type InitializeParams,
    type InitializeResult,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
} from "vscode-languageserver/node";
import { conlog } from "../common";
import {
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SCRIPTS_LST,
    LANG_FALLOUT_SSL,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_LOG,
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TRA,
    LANG_WEIDU_TP2,
} from "../core/languages";
import { parserManager } from "../core/parser-manager";
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
import { formatTra } from "../weidu-tra/format";
import { formatMsg } from "../fallout-msg/format";
import { formatScriptsLst } from "../fallout-scripts-lst/format";
import { getDefinition as getWeiduLogDefinition } from "../weidu-log/definition";
import { Translation } from "../translation";
import { initServerContext, updateServerSettings } from "../server-context";
import { getServerCapabilities } from "../server-capabilities";
import { NOTIFICATION_LOAD_FINISHED } from "../../../shared/protocol";
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

        // Load data and initialize parsers/providers here so the server is fully
        // ready before the initialize response is sent. This closes the race window
        // where onInitialized's async setup had not yet finished but the client was
        // already firing requests (e.g. textDocument/inlayHint).
        const projectSettings = settings.project(workspaceRoot);

        // Initialize translation service
        const translation = new Translation(projectSettings.translation, workspaceRoot);
        await translation.init();

        // Register tree-sitter parsers and initialize them sequentially
        // (web-tree-sitter's shared TRANSFER_BUFFER requires sequential Language.load())
        parserManager.register(LANG_FALLOUT_SSL, "tree-sitter-ssl.wasm", "SSL");
        parserManager.register(LANG_WEIDU_BAF, "tree-sitter-baf.wasm", "BAF");
        parserManager.register(LANG_WEIDU_D, "tree-sitter-weidu_d.wasm", "WeiDU D");
        parserManager.register(LANG_WEIDU_TP2, "tree-sitter-weidu_tp2.wasm", "WeiDU TP2");
        await parserManager.initAll();

        // Register and initialize providers
        registry.register(falloutSslProvider);
        registry.register(falloutWorldmapProvider);
        registry.register(weiduBafProvider);
        registry.register(weiduDProvider);
        registry.register(weiduTp2Provider);
        registry.register({
            id: LANG_WEIDU_LOG,
            async init(): Promise<void> {
                conlog(`${LANG_WEIDU_LOG} provider initialized`);
            },
            definition(text, position, uri) {
                return getWeiduLogDefinition(text, uri, position);
            },
        });
        registry.register(infinity2daProvider);
        registry.register(createFormatOnlyProvider(LANG_WEIDU_TRA, formatTra));
        registry.register(createFormatOnlyProvider(LANG_FALLOUT_MSG, formatMsg));
        registry.register(createFormatOnlyProvider(LANG_FALLOUT_SCRIPTS_LST, formatScriptsLst));

        // Register language aliases (languages that share data with parent providers)
        registry.registerAlias(LANG_WEIDU_SLB, LANG_WEIDU_BAF);
        registry.registerAlias(LANG_WEIDU_SSL, LANG_WEIDU_BAF);

        await registry.init({
            workspaceRoot,
            settings: defaultSettings,
            getDocumentText: (uri) => ctx.documents.get(uri)?.getText(),
            getDocumentVersion: (uri) => ctx.documents.get(uri)?.version,
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
        });

        // Reload translation files for any documents already open
        for (const document of ctx.documents.all()) {
            translation.reloadFile(document.uri, document.languageId, document.getText());
        }

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
            await ctx.connection.client.register(DidChangeConfigurationNotification.type, undefined);
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
        }

        void ctx.connection.sendNotification(NOTIFICATION_LOAD_FINISHED);
        conlog("onInitialized completed");
    });
}
