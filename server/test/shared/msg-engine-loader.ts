/**
 * The Fallout 2 engine's own .msg loader, ported for tests: the oracle the MSG grammar, the translation
 * index and the formatter are held to. The behaviour is the engine's `message_load_field` and
 * `message_parse_number`, ported from the source and checked against the engine functions compiled
 * verbatim in a small C program.
 *
 * - A field starts after a `{`; anything before it (any text, a `#` line, a `//` line) is skipped.
 * - A field is every character up to the next `}`; newlines are dropped; a `{` inside is content.
 * - A `}` met while looking for a `{` fails the whole file, as does end of file inside a field.
 * - A field reaching 1024 bytes fails the file (counted in characters here, which are bytes in the
 *   single-byte code pages the game reads).
 * - The number field must be `[+-]?digits` (a lone sign loads as 0); an empty one fails the file.
 * - A repeated number replaces the earlier entry.
 */

export interface EngineEntry {
    readonly number: number;
    readonly audio: string;
    readonly text: string;
}

export type EngineResult =
    | { readonly ok: true; readonly entries: Map<number, EngineEntry> }
    | { readonly ok: false; readonly reason: string };

const FIELD_LIMIT = 1024;

interface Field {
    readonly status: "ok" | "eof" | "mismatched" | "unterminated" | "too-long";
    readonly value: string;
    readonly next: number;
}

function loadField(text: string, from: number): Field {
    let pos = from;
    for (;;) {
        const ch = text[pos];
        if (ch === undefined) return { status: "eof", value: "", next: pos };
        pos++;
        if (ch === "}") return { status: "mismatched", value: "", next: pos };
        if (ch === "{") break;
    }
    let value = "";
    for (;;) {
        const ch = text[pos];
        if (ch === undefined) return { status: "unterminated", value, next: pos };
        pos++;
        if (ch === "}") return { status: "ok", value, next: pos };
        if (ch !== "\n") {
            value += ch;
            if (value.length >= FIELD_LIMIT) return { status: "too-long", value, next: pos };
        }
    }
}

function parseNumber(field: string): number | undefined {
    if (field === "") return undefined;
    const match = /^[+-]?\d*$/.exec(field);
    if (match === null) return undefined;
    const parsed = Number.parseInt(field, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function loadMsgLikeEngine(text: string): EngineResult {
    const entries = new Map<number, EngineEntry>();
    let pos = 0;
    for (;;) {
        const numberField = loadField(text, pos);
        if (numberField.status === "eof") return { ok: true, entries };
        if (numberField.status !== "ok") return { ok: false, reason: `number field: ${numberField.status}` };
        const audioField = loadField(text, numberField.next);
        if (audioField.status !== "ok") return { ok: false, reason: `audio field: ${audioField.status}` };
        const textField = loadField(text, audioField.next);
        if (textField.status !== "ok") return { ok: false, reason: `text field: ${textField.status}` };
        const number = parseNumber(numberField.value);
        if (number === undefined) return { ok: false, reason: `number [${numberField.value}]` };
        entries.set(number, { number, audio: audioField.value, text: textField.value });
        pos = textField.next;
    }
}
