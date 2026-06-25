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
    return traText.replace(
        /@(\d+)(\s*=\s*~)([^~]*)(~)/g,
        (whole, num: string, sep: string, _old: string, close: string) => {
            const next = messages[num];
            return next === undefined ? whole : `@${num}${sep}${next}${close}`;
        },
    );
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
