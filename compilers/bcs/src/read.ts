/**
 * Reads a BCS into its tree.
 *
 * A BCS line is a run of fields followed by the two-letter marker that opens or closes a block, with no
 * separator between them - `100AC` is a response weight of 100 followed by the marker that opens its first
 * action, and `100RE` is the same weight on a response that has none. Markers pair up: a marker matching
 * the innermost open block closes it, otherwise it opens one.
 */

import type { BcsAction, BcsBlock, BcsObject, BcsResponse, BcsScript, BcsTrigger } from "./types";

const MARKERS = ["SC", "CR", "CO", "TR", "RS", "RE", "AC", "OB"] as const;
type Marker = (typeof MARKERS)[number];

interface Token {
    marker: Marker;
    ints: number[];
    strings: string[];
    line: number;
}

const MARKER_LINE = /^(.*?)(SC|CR|CO|TR|RS|RE|AC|OB)$/;
const FIELDS = /(-?\d+)|"([^"]*)"/g;

/**
 * Splits a line into its fields and its marker. The fields are read by pattern rather than by position,
 * because their count varies by engine and their spacing varies by record - the writer reproduces the
 * spacing from the record's kind, so it does not have to be carried here.
 */
function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    for (const [index, line] of lines.entries()) {
        const match = MARKER_LINE.exec(line);
        if (!match) throw new Error(`Not a BCS line (line ${index + 1}): ${JSON.stringify(line.slice(0, 60))}`);
        const [, content, marker] = match;
        const ints: number[] = [];
        const strings: string[] = [];
        let consumed = 0;
        FIELDS.lastIndex = 0;
        for (let field = FIELDS.exec(content!); field; field = FIELDS.exec(content!)) {
            if (field[1] !== undefined) ints.push(Number(field[1]));
            else strings.push(field[2]!);
            consumed += field[0].length;
        }
        // Everything the fields did not account for has to be the separators the writer puts back.
        if (content!.replaceAll(/\s/g, "").length !== consumed - strings.reduce((n, s) => n + countSpaces(s), 0)) {
            throw new Error(`Unreadable BCS fields (line ${index + 1}): ${JSON.stringify(line.slice(0, 60))}`);
        }
        tokens.push({ marker: marker as Marker, ints, strings, line: index + 1 });
    }
    return tokens;
}

function countSpaces(text: string): number {
    return (text.match(/\s/g) ?? []).length;
}

/** Reads one block, given the token that opened it; leaves the cursor after its closing marker. */
class Cursor {
    private at = 0;
    private readonly tokens: Token[];

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    peek(): Token | undefined {
        return this.tokens[this.at];
    }

    take(expected: Marker): Token {
        const token = this.tokens[this.at];
        if (!token) throw new Error(`Unclosed BCS block: expected ${expected}, reached the end of the file`);
        if (token.marker !== expected) {
            throw new Error(`Expected ${expected} but found ${token.marker} (line ${token.line})`);
        }
        this.at++;
        return token;
    }

    atEnd(): boolean {
        return this.at >= this.tokens.length;
    }
}

function readObject(cursor: Cursor): BcsObject {
    cursor.take("OB");
    const close = cursor.take("OB");
    return { ints: close.ints, string: close.strings[0] ?? "" };
}

function readTrigger(cursor: Cursor): BcsTrigger {
    cursor.take("TR");
    // A trigger's own fields sit on the line that opens its object, and the object's on the one that
    // closes it - so the opening OB is taken here rather than inside readObject.
    const head = cursor.peek();
    if (!head || head.marker !== "OB") throw new Error(`Expected a trigger's fields at line ${head?.line ?? "end"}`);
    cursor.take("OB");
    const close = cursor.take("OB");
    cursor.take("TR");
    return {
        ints: head.ints,
        strings: head.strings,
        object: { ints: close.ints, string: close.strings[0] ?? "" },
    };
}

function readAction(cursor: Cursor): BcsAction {
    cursor.take("AC");
    const idToken = cursor.peek();
    if (!idToken || idToken.marker !== "OB") throw new Error(`Expected an action id at line ${idToken?.line ?? "end"}`);
    cursor.take("OB");
    const first = cursor.take("OB");
    const objects: BcsObject[] = [{ ints: first.ints, string: first.strings[0] ?? "" }];
    while (cursor.peek()?.marker === "OB") objects.push(readObject(cursor));
    const tail = cursor.take("AC");
    return {
        id: idToken.ints[0] ?? 0,
        objects,
        ints: tail.ints,
        strings: tail.strings,
    };
}

function readResponse(cursor: Cursor): BcsResponse {
    cursor.take("RE");
    // The weight rides on whatever marker comes next: the first action's opener, or the response's own
    // closer when it has no actions.
    const weightToken = cursor.peek();
    const weight = weightToken?.ints[0] ?? 0;
    const actions: BcsAction[] = [];
    while (cursor.peek()?.marker === "AC") actions.push(readAction(cursor));
    cursor.take("RE");
    return { weight, actions };
}

function readBlock(cursor: Cursor): BcsBlock {
    cursor.take("CR");
    cursor.take("CO");
    const triggers: BcsTrigger[] = [];
    while (cursor.peek()?.marker === "TR") triggers.push(readTrigger(cursor));
    cursor.take("CO");
    cursor.take("RS");
    const responses: BcsResponse[] = [];
    while (cursor.peek()?.marker === "RE") responses.push(readResponse(cursor));
    cursor.take("RS");
    cursor.take("CR");
    return { triggers, responses };
}

export function readBcs(text: string): BcsScript {
    // A script with no blocks is still `SC`/`SC`, and 28 of the 4941 corpus files are exactly that. A file
    // with no bytes at all is a different thing - two more of them ship - and reading it as an empty script
    // would put two markers into a file the game reads as having no script.
    if (text === "") throw new Error("Empty file: a BCS holds at least the SC markers");
    const cursor = new Cursor(tokenize(text));
    cursor.take("SC");
    const blocks: BcsBlock[] = [];
    while (cursor.peek()?.marker === "CR") blocks.push(readBlock(cursor));
    cursor.take("SC");
    if (!cursor.atEnd()) throw new Error("Trailing content after the closing SC");
    return { blocks };
}
