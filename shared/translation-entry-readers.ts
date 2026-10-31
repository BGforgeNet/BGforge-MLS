/**
 * Readers that find the entries of a `.tra` or `.msg` file: the text each entry holds and where it sits.
 *
 * A `.tra` file is read the way the installer reads it - comments skipped, a string of any of its forms taken
 * whole, so an entry-looking text inside a string or a comment is no entry - and a `.msg` file the way the game
 * loads it. Both are single-pass scanners, because the index is built for every translation file of a project
 * on the main thread at startup, and a parse tree is not available there (the parsers load after it).
 * The translation index and the dialog editor's save path (`dialog-tra-edit.ts`) both read through here, so
 * a file has one reading.
 *
 * The TRA reader restates the rules of the TRA grammar (`grammars/weidu-tra`, including the end it gives an
 * unclosed string or comment), and the MSG reader those of the MSG grammar and the game's loader. The grammars
 * cannot be shared, so each reader is pinned to its reference over the real corpus: the TRA reader to the TRA
 * grammar by `test/integration/translation-index-grammar.test.ts` (with probes), the MSG reader to the game's
 * loader by `test/integration/fallout-msg-engine-differential.test.ts`.
 */

/** One entry as found in the file: its key, the text it holds, and the character range it covers. */
export interface RawEntry {
    /** The entry number as consumers look it up. */
    readonly key: string;
    /** The entry's text, as it reads in the file (newlines inside it kept). */
    readonly source: string;
    /** Offset of the entry's first character (`@` for tra, `{` for msg). */
    readonly start: number;
    /** Offset just past the entry's last character. */
    readonly end: number;
    /**
     * The range an edit of the entry's text replaces. For a tra entry the whole male value, delimiters and any
     * `^` pieces included; for a msg entry the content of the text group, braces excluded.
     */
    readonly valueStart: number;
    readonly valueEnd: number;
    /** Set on a tra entry whose value is `@N`: the key of the entry whose text it takes (see `readTraEntries`). */
    readonly refersTo?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// .msg
// ---------------------------------------------------------------------------------------------------------------

/** The game fails a field on reaching this many characters, newlines not counted. */
const MSG_FIELD_LIMIT = 1024;

interface MsgField {
    readonly value: string;
    /** Offset just past the closing `}`. */
    readonly end: number;
}

/** The field whose `{` is at `open`, or undefined where the game would refuse it (unclosed, or too long). */
function readMsgField(text: string, open: number): MsgField | undefined {
    let length = 0;
    for (let i = open + 1; i < text.length; i++) {
        const char = text[i];
        if (char === "}") return { value: text.slice(open + 1, i), end: i + 1 };
        if (char !== "\n" && ++length >= MSG_FIELD_LIMIT) return undefined;
    }
    return undefined;
}

/** The next field after `from`, with nothing between that the game would stop at: a `}` ends the file there. */
function readNextMsgField(text: string, from: number): MsgField | undefined {
    const open = text.indexOf("{", from);
    if (open === -1 || text.slice(from, open).includes("}")) return undefined;
    return readMsgField(text, open);
}

/** The entry number the game reads from a number field: `[+-]?digits`, a lone sign being 0. */
function msgKey(field: string): string | undefined {
    const digits = field.replaceAll("\n", "");
    if (!/^[+-]?\d*$/.test(digits) || digits === "") return undefined;
    return String(Number.parseInt(digits, 10) || 0);
}

/**
 * Every entry the game would load, found wherever it stands. Where the game would refuse a group, the scan
 * goes on from the next `{`, so one damaged entry does not hide the good ones around it.
 */
export function readMsgEntries(text: string): RawEntry[] {
    const entries: RawEntry[] = [];
    let pos = 0;
    for (;;) {
        const start = text.indexOf("{", pos);
        if (start === -1) return entries;
        const number = readMsgField(text, start);
        const key = number === undefined ? undefined : msgKey(number.value);
        const audio = number === undefined ? undefined : readNextMsgField(text, number.end);
        const body = audio === undefined ? undefined : readNextMsgField(text, audio.end);
        if (key === undefined || body === undefined) {
            pos = start + 1;
            continue;
        }
        entries.push({
            key,
            source: body.value,
            start,
            end: body.end,
            valueStart: body.end - 1 - body.value.length,
            valueEnd: body.end - 1,
        });
        pos = body.end;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// .tra
// ---------------------------------------------------------------------------------------------------------------

const isWhitespace = (char: string | undefined): boolean =>
    char === " " || char === "\t" || char === "\n" || char === "\r";
const isDigit = (char: string | undefined): boolean => char !== undefined && char >= "0" && char <= "9";
const WORD_START = /[0-9A-Za-z_]/;
const WORD_CHAR = /[0-9A-Za-z#_.-]/;

/** At the start of a line: `@N =`, the shape that begins an entry (and `==` is not an assignment). */
function startsEntry(text: string, at: number): boolean {
    if (text[at] !== "@") return false;
    let i = at + 1;
    if (text[i] === "-") i++;
    if (!isDigit(text[i])) return false;
    while (isDigit(text[i])) i++;
    while (text[i] === " " || text[i] === "\t") i++;
    return text[i] === "=" && text[i + 1] !== "=";
}

/**
 * Where an unclosed string or comment that began at `from` ends: the end of the line before the first entry
 * written at the start of a line, else the end of the file. The grammar ends it at the same place.
 */
function unclosedEnd(text: string, from: number): number {
    for (let newline = text.indexOf("\n", from); newline !== -1; newline = text.indexOf("\n", newline + 1)) {
        if (startsEntry(text, newline + 1)) return newline > from ? newline : newline + 1;
    }
    return text.length;
}

interface Piece {
    /** The text between the delimiters. */
    readonly value: string;
    /** Offset just past the string, closing delimiter included. */
    readonly end: number;
    /** False for a string never closed: an entry holding one is left out of the index. */
    readonly closed: boolean;
}

/** The delimited string whose opening delimiter is at `open`; the closer pairs with the first one below. */
function readDelimited(text: string, open: number, delimiter: string): Piece {
    const close = text.indexOf(delimiter, open + 1);
    if (close !== -1) return { value: text.slice(open + 1, close), end: close + 1, closed: true };
    const end = unclosedEnd(text, open + 1);
    return { value: text.slice(open + 1, end), end, closed: false };
}

/** A string at `at` in any of its forms, or undefined when `at` starts none. */
function readStringPiece(text: string, at: number): Piece | undefined {
    const char = text[at];
    if (char === "~") {
        if (text.startsWith("~~~~~", at)) {
            const close = text.indexOf("~~~~~", at + 5);
            const end = close === -1 ? text.length : close;
            return { value: text.slice(at + 5, end), end: close === -1 ? end : close + 5, closed: close !== -1 };
        }
        return readDelimited(text, at, "~");
    }
    if (char === '"' || char === "%") return readDelimited(text, at, char);
    if (char !== undefined && WORD_START.test(char)) {
        let end = at + 1;
        while (end < text.length && WORD_CHAR.test(text[end] ?? "")) end++;
        return { value: text.slice(at, end), end, closed: true };
    }
    return undefined;
}

/** The end of a block comment whose `/*` is at `open`, and whether it closes. Block comments nest. */
function skipBlockComment(text: string, open: number): { end: number; closed: boolean } {
    let depth = 1;
    let i = open + 2;
    while (i < text.length) {
        if (text.startsWith("/*", i)) {
            depth++;
            i += 2;
        } else if (text.startsWith("*/", i)) {
            depth--;
            i += 2;
            if (depth === 0) return { end: i, closed: true };
        } else {
            i++;
        }
    }
    return { end: unclosedEnd(text, open + 2), closed: false };
}

/** The offset of the next token after `from`: whitespace and comments skipped. */
function skipTrivia(text: string, from: number): number {
    let i = from;
    for (;;) {
        if (isWhitespace(text[i])) {
            i++;
        } else if (text.startsWith("//", i)) {
            const newline = text.indexOf("\n", i);
            i = newline === -1 ? text.length : newline;
        } else if (text.startsWith("/*", i)) {
            i = skipBlockComment(text, i).end;
        } else {
            return i;
        }
    }
}

/**
 * `@` and its number at `at`, as written; undefined where the text there is no entry number. The grammar lets
 * spaces stand between a heading's `@` and its number (the formatter closes the gap); a value's `@N` has none.
 */
function readEntryNumber(text: string, at: number, allowGap: boolean): { key: string; end: number } | undefined {
    let i = at + 1;
    if (allowGap) {
        while (text[i] === " " || text[i] === "\t") i++;
    }
    const numberStart = i;
    if (text[i] === "-") i++;
    if (!isDigit(text[i])) return undefined;
    while (isDigit(text[i])) i++;
    return { key: text.slice(numberStart, i), end: i };
}

interface Value {
    readonly source: string;
    /** Set when the value is `@N`, the text of another entry, to be resolved once every entry is known. */
    readonly refersTo?: string;
    readonly end: number;
}

/** The offset of the first character after `from` that is not whitespace. */
function skipWhitespace(text: string, from: number): number {
    let i = from;
    while (isWhitespace(text[i])) i++;
    return i;
}

/** The value of an entry, from `at`: a string, strings joined by `^`, or a reference to another string. */
function readValue(text: string, at: number): Value | undefined {
    const char = text[at];
    if (char === "#") {
        let i = at + 1;
        if (text[i] === "-") i++;
        if (!isDigit(text[i])) return undefined;
        while (isDigit(text[i])) i++;
        return { source: text.slice(at, i), end: i };
    }
    if (char === "@") {
        const ref = readEntryNumber(text, at, false);
        if (ref === undefined) return undefined;
        // `@N =` is the next entry, which leaves this one with no value.
        const next = skipWhitespace(text, ref.end);
        if (text[next] === "=" && text[next + 1] !== "=") return undefined;
        return { source: text.slice(at, ref.end), refersTo: ref.key, end: ref.end };
    }
    if (char === "(") {
        const at2 = skipTrivia(text, at + 1);
        if (!text.startsWith("AT", at2)) return undefined;
        const inner = readStringPiece(text, skipTrivia(text, at2 + 2));
        if (inner === undefined || !inner.closed) return undefined;
        const close = skipTrivia(text, inner.end);
        return text[close] === ")" ? { source: text.slice(at, close + 1), end: close + 1 } : undefined;
    }
    // A string never closed leaves the entry out: the installer refuses the file, and half a text is no preview.
    let piece = readStringPiece(text, at);
    if (piece === undefined || !piece.closed) return undefined;
    let source = piece.value;
    for (;;) {
        const next = skipTrivia(text, piece.end);
        if (text[next] !== "^") return { source, end: piece.end };
        const following = readStringPiece(text, skipTrivia(text, next + 1));
        if (following === undefined || !following.closed) return { source, end: piece.end };
        source += following.value;
        piece = following;
    }
}

/** How many `@N` hops are followed to the text an entry names; a longer chain is a loop. */
const MAX_REFERENCE_HOPS = 16;

/**
 * Every entry the installer would read. The scan goes token by token, so what stands inside a string or a
 * comment is never an entry, and an entry with no value yet is left out without hiding the one below it.
 */
export function readTraEntries(text: string): RawEntry[] {
    return readTraFile(text).entries;
}

/**
 * The entries of `readTraEntries`, and the offset of the first string or block comment that never closes. Every
 * unclosed one is met by the scan's own loop: an entry whose value holds one is skipped, and the scan walks on
 * through that value.
 */
export function readTraFile(text: string): { entries: RawEntry[]; unclosedAt: number | undefined } {
    const entries: RawEntry[] = [];
    let unclosedAt: number | undefined;
    let i = 0;
    while (i < text.length) {
        const char = text[i] ?? "";
        if (isWhitespace(char)) {
            i++;
        } else if (text.startsWith("//", i)) {
            const newline = text.indexOf("\n", i);
            i = newline === -1 ? text.length : newline;
        } else if (text.startsWith("/*", i)) {
            const comment = skipBlockComment(text, i);
            if (!comment.closed) unclosedAt ??= i;
            i = comment.end;
        } else if (char === "@") {
            const number = readEntryNumber(text, i, true);
            const equals = number === undefined ? -1 : skipTrivia(text, number.end);
            const valueStart = text[equals] === "=" ? skipTrivia(text, equals + 1) : -1;
            const value = number !== undefined && valueStart !== -1 ? readValue(text, valueStart) : undefined;
            if (number === undefined || value === undefined) {
                i++;
                continue;
            }
            entries.push({
                key: number.key,
                source: value.source,
                start: i,
                end: value.end,
                valueStart,
                valueEnd: value.end,
                refersTo: value.refersTo,
            });
            i = value.end;
        } else if (char === "[") {
            // A sound: it holds no entries, and a `~` or `%` in it is not a string. One never closed ends at the line.
            const close = text.indexOf("]", i + 1);
            const newline = text.indexOf("\n", i + 1);
            i = close !== -1 && (newline === -1 || close < newline) ? close + 1 : i + 1;
        } else {
            const piece = readStringPiece(text, i);
            if (piece?.closed === false) unclosedAt ??= i;
            i = piece?.end ?? i + 1;
        }
    }
    return { entries: resolveReferences(entries), unclosedAt };
}

/** An entry whose value is `@N` takes the text of entry N when the file has it, and keeps the reference if not. */
function resolveReferences(entries: RawEntry[]): RawEntry[] {
    if (!entries.some((entry) => entry.refersTo !== undefined)) return entries;
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    return entries.map((entry) => {
        let target = entry;
        for (let hops = 0; target.refersTo !== undefined && hops < MAX_REFERENCE_HOPS; hops++) {
            const next = byKey.get(target.refersTo);
            if (next === undefined) return entry;
            target = next;
        }
        return target.refersTo === undefined ? { ...entry, source: target.source } : entry;
    });
}
