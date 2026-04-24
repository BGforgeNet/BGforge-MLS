/**
 * IESDP action processing for BAF scripting.
 * Handles action description resolution (including aliases), URL absolutization,
 * deduplication, and signature formatting.
 */

import { htmlInlineToText, normalizeHtmlFragment } from "./common.ts";
import type { ActionItem, IESDPGame } from "./types.ts";

const DISPLAY_TYPE_NAMES: Readonly<Record<string, string>> = {
    // Match @bgforge/iets type naming for compound refs (CreRef, ItmRef, SplRef, StrRef)
    // instead of blindly uppercasing the raw IESDP tokens (creref, itmref, splref, strref).
    creref: "CreRef",
    itmref: "ItmRef",
    splref: "SplRef",
    strref: "StrRef",
};

/**
 * Resolves the description for an aliased action by looking up the parent action.
 * Returns false if the parent action is unknown.
 */
export function actionAliasDesc(actions: readonly ActionItem[], action: ActionItem): string | false {
    const num = action.alias === true ? action.n : action.alias;
    const parent = actions.find((x) => x.n === num && x.alias === undefined);

    if (parent === undefined) {
        return false;
    }
    if (parent.unknown !== undefined) {
        return false;
    }
    return parent.desc ?? false;
}

/**
 * Gets the description for an action, resolving aliases if necessary.
 * Converts relative URLs in the description to absolute IESDP URLs.
 * Returns false if the action has no usable description.
 */
export function actionDesc(
    actions: readonly ActionItem[],
    action: ActionItem,
    iesdpGames: readonly IESDPGame[],
    iesdpBaseUrl: string,
): string | false {
    let desc: string | false;

    if (action.alias !== undefined) {
        desc = actionAliasDesc(actions, action);
        if (desc === false) {
            return false;
        }
    } else {
        desc = action.desc ?? false;
    }

    if (desc === false) {
        return false;
    }

    const gameName = action.bg2 !== undefined ? "bg2" : "bgee";
    return actionDescAbsoluteUrls(desc, iesdpGames, gameName, iesdpBaseUrl);
}

/**
 * Resolves relative and variable-based URLs in action descriptions to absolute IESDP URLs.
 * Replaces {{ ids }} and {{ 2da }} template variables, then resolves relative links.
 *
 * Rationale: this importer intentionally uses targeted normalization rather than a full HTML
 * parser/renderer. The IESDP action docs in this pipeline are a narrow, known subset of
 * markdown plus a few HTML/Jekyll constructs (`<a>`, `<code>`, `<sup>`, `<br>`, wrapper tags,
 * `trigger_link.html`, common entities). We convert that subset into markdown/plain text for
 * hover data, not general HTML output. If the source format expands materially, the better
 * long-term design is to switch this step to an HTML fragment parser plus a small markdown
 * renderer instead of growing the regex-based normalizer indefinitely.
 */
export function actionDescAbsoluteUrls(
    desc: string,
    games: readonly IESDPGame[],
    gameName: string,
    iesdpBaseUrl: string,
): string {
    const game = games.find((x) => x.name === gameName);
    if (game === undefined) {
        throw new Error(`Game not found: ${gameName}`);
    }

    const ids = game.ids.replace(/^\//, "");
    const twoda = game["2da"].replace(/^\//, "");
    const actionsUrl = game.actions;

    let result = desc.replace(/\{\{ ids \}\}/g, ids).replace(/\{\{ 2da \}\}/g, twoda);

    const currentUrl = resolveUrl(iesdpBaseUrl, actionsUrl.replace(/^\//, ""));
    const urls = [...result.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)];

    for (const match of urls) {
        // Safe: regex group 2 always exists when matchAll succeeds
        const dst = match[2]!.trim();
        const dstAbs = resolveUrl(currentUrl, dst);
        // Replace the full link reference `](url)` to avoid matching `dst` inside
        // already-resolved URLs (e.g. a bare `#130` matching within `bg2actions.htm#130`).
        result = result.replace(`](${dst})`, `](${dstAbs})`);
    }

    return normalizeActionMarkup(result, currentUrl);
}

/**
 * Resolves a relative URL against a base URL, matching Python's urllib.parse.urljoin behavior.
 * Does NOT percent-encode characters (unlike the WHATWG URL API), which is important
 * because some descriptions contain literal braces from Jekyll template variables.
 */
function resolveUrl(base: string, relative: string): string {
    if (/^https?:\/\//.test(relative)) {
        return relative;
    }

    // Fragment-only URL: append to base (matching Python's urljoin)
    if (relative.startsWith("#")) {
        const baseWithoutFragment = base.replace(/#.*$/, "");
        return baseWithoutFragment + relative;
    }

    const originMatch = base.match(/^(https?:\/\/[^/]+)/);
    const origin = originMatch?.[1] ?? "";

    if (relative.startsWith("/")) {
        return origin + relative;
    }

    // Resolve relative path against base directory, normalizing ../ segments
    const baseDir = base.replace(/^https?:\/\/[^/]+/, "").replace(/[^/]*$/, "");
    const combined = baseDir + relative;
    const parts = combined.split("/");
    const resolved: string[] = [];

    for (const part of parts) {
        if (part === "..") {
            resolved.pop();
        } else if (part !== ".") {
            resolved.push(part);
        }
    }

    return origin + resolved.join("/");
}

function normalizeActionMarkup(desc: string, currentUrl: string): string {
    return normalizeHtmlFragment(desc, {
        preprocess: (html) => replaceTriggerLinkIncludes(html, currentUrl),
        resolveHref: (href) => resolveUrl(currentUrl, href),
    });
}

function replaceTriggerLinkIncludes(desc: string, currentUrl: string): string {
    let triggerUrl = currentUrl.replace("/scripting/actions/", "/scripting/triggers/");
    if (/actions\.htm(?=#|$)/.test(triggerUrl)) {
        triggerUrl = triggerUrl.replace(/actions\.htm(?=#|$)/, "triggers.htm");
    } else {
        triggerUrl = triggerUrl.replace(/\/([^/]+?)(?=#|$)/, "/$1triggers.htm");
    }

    return desc.replace(
        /\{%-?\s*assign\s+text\s*=\s*"([\s\S]*?)"\s*-?%\}\s*\{%-?\s*assign\s+anchor\s*=\s*"([^"]+)"\s*-?%\}\s*\{%-?\s*include\s+trigger_link\.html\s*-?%\}/g,
        (_m, text: string, anchor: string) => `[${htmlInlineToText(text)}](${triggerUrl}#${anchor})`,
    );
}
/**
 * Appends actions to the list, skipping those whose name already exists.
 * Returns a new array (does not mutate the input).
 */
export function appendUnique(actions: readonly ActionItem[], newActions: readonly ActionItem[]): readonly ActionItem[] {
    const result = [...actions];
    for (const newAction of newActions) {
        if (/^reserved\d*$/i.test(newAction.name)) {
            continue;
        }
        const exists = result.some((x) => x.name === newAction.name);
        if (!exists) {
            result.push(newAction);
        }
    }
    return result;
}

/**
 * Formats an action's signature for display as a detail string.
 * Example: "ActionName(I:Target*Actor, S:ResRef)"
 */
export function actionDetail(action: ActionItem): string {
    if (action.params === undefined) {
        return `${action.name}()`;
    }
    const paramParts = action.params.map((param) => {
        let part = `${displayTypeName(param.type)}:${param.name}`;
        if (param.ids !== undefined) {
            part = `${part}*${titleCase(param.ids)}`;
        }
        return part;
    });
    return `${action.name}(${paramParts.join(", ")})`;
}

function displayTypeName(type: string): string {
    const mapped = DISPLAY_TYPE_NAMES[type.toLowerCase()];
    if (mapped) {
        return mapped;
    }
    return type.toUpperCase();
}

/** Converts a string to title case (first letter uppercase) */
function titleCase(s: string): string {
    if (s.length === 0) {
        return s;
    }
    // Safe: length > 0 checked above
    return s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}
