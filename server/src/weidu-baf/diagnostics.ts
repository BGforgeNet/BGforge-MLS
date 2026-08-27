/**
 * Chooses which compiler produces BAF diagnostics: the external WeiDU binary (the default) or the extension's
 * own compiler. Shared by the plain `.baf` provider and the `.tbaf` transpile chain so the two entry points
 * cannot drift on which compiler ran for a given setting.
 */

import { compileSymbolsFrom } from "../../../compilers/bcs/src/index";
import { bcsEngineForScriptStyle } from "../../../shared/bcs-engine";
import { parserManager } from "../../../shared/parsers/parser-manager";
import { LANG_WEIDU_BAF } from "../core/languages";
import type { NormalizedUri } from "../core/normalized-uri";
import { sendParseResult } from "../diagnostics";
import { getServerContext } from "../server-context";
import type { MLSsettings } from "../settings";
import { showWarning } from "../user-messages";
import { compile as weiduCompile } from "../weidu-compile";
import { compileBafText } from "./compiler";

/**
 * Produce BAF diagnostics for `uri` with whichever compiler `settings.weidu.compiler` selects.
 *
 * NOT named `compileBaf`: the codec exports a `compileBaf` that does something different, and one name for
 * two functions in one subsystem is a trap for the next reader.
 *
 * The external route always reaches `weiduCompile`, which owns its own gamePath/path guards and their
 * user-facing warnings - unconditionally, exactly as every caller of it already did before this dispatcher
 * existed. Only the built-in branch gates here, since it needs a game to resolve names against and has no
 * warning of its own to fall back on.
 */
export async function runBafDiagnostics(
    uri: NormalizedUri,
    text: string,
    settings: MLSsettings,
    interactive: boolean,
): Promise<boolean> {
    if (settings.weidu.compiler === "built-in") {
        if (!settings.weidu.gamePath) {
            if (interactive) {
                showWarning(
                    "Path to IE game is not specified in settings, can't parse BAF with the built-in compiler!",
                );
            }
            return false;
        }
        if (!parserManager.isInitialized(LANG_WEIDU_BAF)) return false;
        const { configuredGame } = await getServerContext();
        const tables = configuredGame.tables(settings.weidu);
        const style = configuredGame.scriptStyle(settings.weidu);
        if (tables === undefined || style === undefined) {
            if (interactive) {
                showWarning(
                    `Cannot open IE game at "${settings.weidu.gamePath}", can't parse BAF with the built-in compiler!`,
                );
            }
            return false;
        }
        const result = compileBafText({
            text,
            uri,
            parser: parserManager.getParser(LANG_WEIDU_BAF),
            symbols: compileSymbolsFrom(tables),
            engine: bcsEngineForScriptStyle(style),
        });
        // The document is its own source: this compiler reads the buffer, so there is no tmp uri to remap.
        sendParseResult(result, uri, uri);
        return true;
    }
    await weiduCompile(uri, settings.weidu, interactive, text);
    return true;
}
