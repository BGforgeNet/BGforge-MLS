/**
 * Surgical rewrite of WeiDU `.tra` translation entries.
 *
 * Editing an `@N` dialogue line updates the in-memory message map; persisting it
 * means rewriting only that entry's value in the `.tra`, leaving the file otherwise
 * byte-for-byte unchanged (comments, ordering, formatting, untouched entries). This
 * is the `.tra` counterpart of the surgical `.d` edit in `dialog-d-edit.ts`.
 *
 * `rewriteTraEntries` edits only entries that already exist in the `.tra`; `appendTraEntries` adds the
 * brand-new ids the D-family allocator mints for editor-authored text (a new option or state). Entries are
 * found by the same reader as the translation index (`translation-entry-readers.ts`), so an entry the
 * installer would not read - commented out, or written inside a string - is neither edited nor counted
 * as present, and a value of any string form is edited.
 */
import * as path from "path";
import { readMsgEntries, readTraEntries, type RawEntry } from "./translation-entry-readers";

/** A tra delimiter pair that does not occur in `text`, preferring the one the replaced value used. */
function traLiteral(text: string, preferred: "~" | '"' | "%" | "~~~~~"): string {
    const delimiter = [preferred, "~", '"', "%", "~~~~~"].find((open) => !text.includes(open)) ?? "~~~~~";
    return `${delimiter}${text}${delimiter}`;
}

/** The delimiter a tra entry's value is written with, when it is a single string. */
function valueDelimiter(traText: string, entry: RawEntry): "~" | '"' | "%" | "~~~~~" {
    if (traText.startsWith("~~~~~", entry.valueStart)) return "~~~~~";
    const first = traText[entry.valueStart];
    return first === '"' || first === "%" ? first : "~";
}

/** Replace the `range` of each entry that has a message, from the end so earlier offsets stay valid. */
function applyEdits(text: string, edits: Array<{ start: number; end: number; with: string }>): string {
    let out = text;
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);
    }
    return out;
}

export function rewriteTraEntries(traText: string, messages: Record<string, string>): string {
    const edits: Array<{ start: number; end: number; with: string }> = [];
    for (const entry of readTraEntries(traText)) {
        const next = Object.hasOwn(messages, entry.key) ? messages[entry.key] : undefined;
        if (next === undefined) continue;
        edits.push({
            start: entry.valueStart,
            end: entry.valueEnd,
            with: traLiteral(next, valueDelimiter(traText, entry)),
        });
    }
    return applyEdits(traText, edits);
}

/**
 * Surgical rewrite of Fallout `.msg` translation entries (`{id}{sound}{text}`).
 *
 * The `.msg` counterpart of `rewriteTraEntries`: replace only the text group of an entry whose
 * id is in `messages`, preserving the id, the sound field, the brace spacing, and every untouched
 * byte. Entries are the ones the game loads (the shared reader), wherever they sit in the file, so the
 * rewriter acts on exactly the entries the editor indexed. A `.tra`-format rewriter never matches a `.msg`
 * line, so the two formats need separate writers - using the wrong one silently no-ops the save.
 */
export function rewriteMsgEntries(msgText: string, messages: Record<string, string>): string {
    const edits: Array<{ start: number; end: number; with: string }> = [];
    for (const entry of readMsgEntries(msgText)) {
        const next = Object.hasOwn(messages, entry.key) ? messages[entry.key] : undefined;
        if (next !== undefined) edits.push({ start: entry.valueStart, end: entry.valueEnd, with: next });
    }
    return applyEdits(msgText, edits);
}

/**
 * Append brand-new Fallout `.msg` entries (`{id}{}{text}`) for ids not already present. The counterpart to
 * `rewriteMsgEntries`, which only edits existing entries: a newly-added dialog option's text has no entry
 * yet, so it is appended. Existing bytes are preserved; only an entry whose id is absent is added, in the
 * order given. Ensures the file ends with a newline before appending so entries stay one-per-line.
 */
export function appendMsgEntries(msgText: string, entries: Record<string, string>): string {
    const present = new Set(readMsgEntries(msgText).map((entry) => entry.key));
    const additions = Object.entries(entries).filter(([id]) => !present.has(id));
    if (additions.length === 0) return msgText;
    const base = msgText.length > 0 && !msgText.endsWith("\n") ? msgText + "\n" : msgText;
    return base + additions.map(([id, text]) => `{${id}}{}{${text}}\n`).join("");
}

/**
 * Append brand-new `.tra` entries (`@N = ~text~`) for ids not already present - the `.tra` counterpart of
 * `appendMsgEntries`. The D-family id allocator mints a fresh `@N` for text authored in the dialog editor
 * (a new option or state), so the save path must be able to add the entry the spliced `.d`/`.td` now
 * references; a rewrite-only path silently drops that text. Only an id absent from the file is appended,
 * in the order given; existing bytes are preserved, and the file is newline-terminated before appending
 * so entries stay one-per-line.
 */
export function appendTraEntries(traText: string, entries: Record<string, string>): string {
    const present = new Set(readTraEntries(traText).map((entry) => entry.key));
    const additions = Object.entries(entries).filter(([id]) => !present.has(id));
    if (additions.length === 0) return traText;
    const base = traText.length > 0 && !traText.endsWith("\n") ? traText + "\n" : traText;
    return base + additions.map(([id, text]) => `@${id} = ${traLiteral(text, "~")}\n`).join("");
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
