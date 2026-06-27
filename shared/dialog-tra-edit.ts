/**
 * Surgical rewrite of WeiDU `.tra` translation entries.
 *
 * Editing an `@N` dialogue line updates the in-memory message map; persisting it
 * means rewriting only that entry's value in the `.tra`, leaving the file otherwise
 * byte-for-byte unchanged (comments, ordering, formatting, untouched entries). This
 * is the `.tra` counterpart of the surgical `.d` edit in `dialog-d-edit.ts`.
 *
 * Only entries that already exist in the `.tra` are rewritten - new literal text in
 * the editor stays literal in the `.d` and never becomes an `@N`. The entry value
 * grammar matches the parser's (`@N = ~...~`, value is everything up to the next
 * tilde, newlines included).
 */
import * as path from "path";

export function rewriteTraEntries(traText: string, messages: Record<string, string>): string {
    return traText.replaceAll(
        /@(\d+)(\s*=\s*~)([^~]*)(~)/g,
        (whole, num: string, sep: string, _old: string, close: string) => {
            const next = messages[num];
            return next === undefined ? whole : `@${num}${sep}${next}${close}`;
        },
    );
}

/**
 * Surgical rewrite of Fallout `.msg` translation entries (`{id}{sound}{text}`).
 *
 * The `.msg` counterpart of `rewriteTraEntries`: replace only the text group of an entry whose
 * id is in `messages`, preserving the id, the sound field, the brace spacing, and every untouched
 * byte. The entry grammar matches the parser's (`{(\d+)}\s*{\w*}\s*{([^}]*)}`), so the rewriter
 * acts on exactly the entries the editor indexed. A `.tra`-format rewriter never matches a `.msg`
 * line, so the two formats need separate writers - using the wrong one silently no-ops the save.
 */
export function rewriteMsgEntries(msgText: string, messages: Record<string, string>): string {
    return msgText.replaceAll(
        /({(\d+)}\s*{\w*}\s*{)([^}]*)(})/g,
        (whole, prefix: string, num: string, _old: string, close: string) => {
            const next = messages[num];
            return next === undefined ? whole : `${prefix}${next}${close}`;
        },
    );
}

/**
 * Append brand-new Fallout `.msg` entries (`{id}{}{text}`) for ids not already present. The counterpart to
 * `rewriteMsgEntries`, which only edits existing entries: a newly-added dialog option's text has no entry
 * yet, so it is appended. Existing bytes are preserved; only an entry whose id is absent is added, in the
 * order given. Ensures the file ends with a newline before appending so entries stay one-per-line.
 */
export function appendMsgEntries(msgText: string, entries: Record<string, string>): string {
    const present = new Set<string>();
    for (const m of msgText.matchAll(/{(\d+)}\s*{\w*}\s*{[^}]*}/g)) present.add(m[1]!);
    const additions = Object.entries(entries).filter(([id]) => !present.has(id));
    if (additions.length === 0) return msgText;
    const base = msgText.length > 0 && !msgText.endsWith("\n") ? msgText + "\n" : msgText;
    return base + additions.map(([id, text]) => `{${id}}{}{${text}}\n`).join("");
}

/**
 * Candidate sibling-language `.tra` paths for a WeiDU `tra/<language>/<file>.tra`
 * layout: the same base file under every OTHER language directory beside the active
 * one. Pure (path math only); the caller filters to those that actually exist on disk.
 *
 * Used by the save path to warn that an `@N` edit, which rewrites only the active
 * language's `.tra`, has left these sibling translations stale. With a flat (single-
 * language) `tra/` layout this returns paths that simply do not exist, so the caller's
 * existence filter yields no false warning.
 */
export function siblingTraCandidates(activeTraPath: string, languageDirNames: string[]): string[] {
    const dir = path.dirname(activeTraPath);
    const activeLang = path.basename(dir);
    const langParent = path.dirname(dir);
    const base = path.basename(activeTraPath);
    return languageDirNames.filter((lang) => lang !== activeLang).map((lang) => path.join(langParent, lang, base));
}
