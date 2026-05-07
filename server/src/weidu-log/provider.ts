/**
 * WeiDU log language provider.
 * Surfaces go-to-definition for the `~path/to/mod.tp2~` mod path entries that
 * appear in `weidu.log`; the file has no other addressable constructs.
 */

import { conlog } from "../common";
import { LANG_WEIDU_LOG } from "../core/languages";
import type { LanguageProvider, ProviderBase, ProviderContext, NavigationCapability } from "../language-provider";
import { getDefinition as getWeiduLogDefinition } from "./definition";

class WeiduLogProvider implements ProviderBase, NavigationCapability {
    readonly id = LANG_WEIDU_LOG;

    async init(_context: ProviderContext): Promise<void> {
        conlog(`${LANG_WEIDU_LOG} provider initialized`);
    }

    definition(text: string, position: Parameters<NonNullable<NavigationCapability["definition"]>>[1], uri: string) {
        return getWeiduLogDefinition(text, uri, position);
    }
}

export const weiduLogProvider: LanguageProvider = new WeiduLogProvider();
