/**
 * Choosing a game string by what it says rather than by its number.
 *
 * A strref is an opaque integer, so setting one by hand means knowing the number already. This offers the
 * string table as a searchable list and hands back the number to store.
 */

import * as vscode from "vscode";
import type { StrrefMatch, StrrefSearch } from "./game-lookups";

/** How many hits one keystroke fetches. Enough to fill the list; a narrower query is the way to find more. */
const PAGE_SIZE = 100;

/** Shown for an entry the table holds but leaves blank, so the row is not an unexplained empty line. */
const EMPTY_LABEL = "(empty string)";

export interface StrrefPickItem extends vscode.QuickPickItem {
    readonly strref: number;
}

/** A whole query of digits means the user knows the number; anything else is text to search for. */
function queriedStrref(query: string): number | undefined {
    return /^\d+$/.test(query.trim()) ? Number(query.trim()) : undefined;
}

/** One row per string: newlines flattened, since a quick pick row is a single line. */
function itemFor(strref: number, text: string): StrrefPickItem {
    return {
        label: text === "" ? EMPTY_LABEL : text.replaceAll(/\s*\n\s*/g, " "),
        description: `#${strref}`,
        // The search decided what matches; without this the client re-filters and hides hits that matched on
        // case or on a part of the string the typed text does not prefix.
        alwaysShow: true,
        strref,
    };
}

/**
 * The rows to show for `query`. A query that is just a number offers that entry first - it is the one thing a
 * text search cannot find - and never twice if the search returned it as well.
 */
export function strrefPickItems(
    query: string,
    matches: readonly StrrefMatch[],
    lookup: (strref: number) => string | undefined,
): StrrefPickItem[] {
    const exact = queriedStrref(query);
    const exactText = exact === undefined ? undefined : lookup(exact);
    const rows = matches.filter((match) => match.strref !== exact).map((match) => itemFor(match.strref, match.text));
    // An out-of-range number resolves to undefined and is simply not offered - there is nothing to choose.
    return exactText === undefined ? rows : [itemFor(exact!, exactText), ...rows];
}

export interface PickStrrefOptions {
    /** Shown above the list; name what the string is for. */
    readonly title?: string;
}

/**
 * Show the picker and resolve to the chosen strref, or undefined if it was dismissed. Results are fetched per
 * keystroke rather than up front: a real `dialog.tlk` holds six figures of strings.
 *
 * The search is async because the string table is decoded in chunks that yield to the event loop - the editor
 * stays responsive while it builds, where a single synchronous pass froze the whole extension host.
 */
export async function pickStrref(
    search: StrrefSearch,
    lookup: (strref: number) => string | undefined,
    uri: vscode.Uri,
    options: PickStrrefOptions = {},
): Promise<number | undefined> {
    const opening = strrefPickItems("", await search(uri, "", PAGE_SIZE), lookup);
    // Nothing at all for the empty query means there is no string table to search - an open game answers it
    // with its first entries. Say so before opening anything, rather than showing a picker that reports "no
    // matching results" and so blames the query for a missing game.
    if (opening.length === 0) {
        void vscode.window.showWarningMessage("Open a game first - its dialog.tlk is where the strings come from.");
        return undefined;
    }

    const quickPick = vscode.window.createQuickPick<StrrefPickItem>();
    quickPick.title = options.title ?? "Choose a game string";
    quickPick.placeholder = "Search the game's text, or type a string number";
    // The search does its own matching, so the client must not filter the results again.
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.items = opening;

    // Two keystrokes can be in flight at once, and nothing orders their results. Stamp each search and let
    // only the newest one write: without this a slower earlier query lands last and the list shows results
    // for text the user has already typed past.
    let issued = 0;
    const refresh = (query: string): void => {
        const seq = ++issued;
        void search(uri, query, PAGE_SIZE).then((matches) => {
            if (seq !== issued) return;
            quickPick.items = strrefPickItems(query, matches, lookup);
        });
    };

    return new Promise<number | undefined>((resolve) => {
        let picked: number | undefined;
        quickPick.onDidChangeValue(refresh);
        quickPick.onDidAccept(() => {
            picked = quickPick.selectedItems[0]?.strref;
            quickPick.hide();
        });
        // Fires for an accepted pick too, so it is the single place the promise settles and the picker is
        // disposed - no path can leave it on screen or the promise pending.
        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(picked);
        });
        quickPick.show();
    });
}
