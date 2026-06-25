/**
 * Side-effect classification for the SSL dialog honesty badges.
 *
 * A Fallout SSL builtin whose signature returns `void` is called for its effect rather
 * than its value - it mutates game state (globals, inventory, perks, party, the map) that
 * the dialog text does not reveal. That void-return signal is the side-effect set the
 * dialog parser flags a node with.
 *
 * Where the signal lives: the structured `detail` is not surfaced on the runtime symbol -
 * the generator embeds the signature as the first line of the tooltip fence in each
 * builtin's hover markdown (`buildSignatureBlock` emits ```<tooltipLang>\n<signature>\n```).
 * We read it back from there. Surfacing a structured return-type field instead would mean
 * changing the shared data generator and regenerating every language's data for one badge -
 * disproportionate - so this stays local and is coupled to the real emitter via its test.
 *
 * One deliberate exclusion: a small set of void builtins only *show text* (a floating
 * message, a debug line, a movie/stats screen). Badging those would fire the side-effect
 * badge on nearly every dialog node - over-badging a trust feature into noise - so they are
 * filtered out. This display/debug allowlist is the boundary call for the feature; it is
 * intentionally narrow (text/output only) and excludes real effects like `signal_end_game`.
 */

import type { Hover } from "vscode-languageserver/node";
import { loadStaticSymbols } from "../core/static-loader";
import { LANG_FALLOUT_SSL, LANG_FALLOUT_SSL_TOOLTIP } from "../core/languages";

/**
 * Void builtins excluded from the side-effect set: they present text/output to the player
 * or developer and mutate no hidden game state. Kept narrow on purpose - a real
 * state-changing void fn (e.g. `signal_end_game`) must NOT be added here.
 */
const SSL_DISPLAY_FNS: ReadonlySet<string> = new Set([
    "display_msg", // prints a message to the dialog/message window
    "debug_msg", // developer debug output
    "float_msg", // floating text above a critter
    "display", // shows a movie/text file
    "display_stats", // opens the stats screen (sfall)
]);

// The signature is the line immediately after the tooltip fence opener in the hover
// markdown (see buildSignatureBlock). Capture that first line to read its return type.
const SIGNATURE_RE = new RegExp("```" + LANG_FALLOUT_SSL_TOOLTIP + "\\n(.+)");

/** A name plus the hover markdown that carries its generated signature block. */
interface SslSymbolDoc {
    name: string;
    markdown: string;
}

/**
 * The set of SSL builtins that count as state-mutating side-effects: those whose tooltip
 * signature returns `void`, minus the display/debug allowlist. Pure over the given symbols.
 */
export function sslSideEffectFunctions(symbols: readonly SslSymbolDoc[]): Set<string> {
    const set = new Set<string>();
    for (const { name, markdown } of symbols) {
        const signature = markdown.match(SIGNATURE_RE)?.[1];
        if (signature?.startsWith("void ") && !SSL_DISPLAY_FNS.has(name)) {
            set.add(name);
        }
    }
    return set;
}

/** Flatten a Hover's contents to a markdown string. Static symbols always carry MarkupContent. */
function hoverMarkdown(contents: Hover["contents"]): string {
    if (typeof contents === "string") return contents;
    if (Array.isArray(contents)) {
        return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n");
    }
    return contents.value;
}

// SSL builtin data is static and immutable for the process lifetime, so derive the set once
// and reuse it across every dialog parse rather than re-loading and re-filtering each time.
let cached: ReadonlySet<string> | undefined;

/** The live side-effect set, derived from the loaded SSL builtin data and memoized. */
export function getSSLSideEffectFunctions(): ReadonlySet<string> {
    cached ??= sslSideEffectFunctions(
        loadStaticSymbols(LANG_FALLOUT_SSL).map((s) => ({ name: s.name, markdown: hoverMarkdown(s.hover.contents) })),
    );
    return cached;
}
