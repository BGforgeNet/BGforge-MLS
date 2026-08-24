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

/** One field of a line: a number, a quoted string, or a bracketed group of numbers. */
type Field = { kind: "int"; value: number } | { kind: "string"; value: string } | { kind: "group"; values: number[] };

interface Token {
    marker: Marker;
    /** Every field in stored order. Order matters: IWD2 puts numbers on both sides of an object's name. */
    fields: Field[];
    ints: number[];
    strings: string[];
    line: number;
}

const MARKER_LINE = /^(.*?)(SC|CR|CO|TR|RS|RE|AC|OB)$/;
const FIELDS = /(-?\d+)|"([^"]*)"|\[([^\]]*)\]/g;

/**
 * Splits a line into its fields and its marker. Fields are matched as whole tokens - a number, a quoted
 * string, or a bracketed group - never digits scanned out of a line, because an object's name is a string
 * that routinely ends in a digit (`"HOUSEN2"`, `"Druid3"`) and counting numbers across the line would read
 * that digit as another field. Whatever no field pattern accounts for is a parse error rather than something
 * to skip, so a construct this does not model is refused by name instead of silently misread.
 *
 * A bracketed group is an object's rectangle (`[x.y.w.h]`) or a PST trigger's point (`[x,y]`); both split on
 * either separator, and which one a record carries follows from where it sits rather than from its spelling.
 */
function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    for (const [index, line] of lines.entries()) {
        const match = MARKER_LINE.exec(line);
        if (!match) throw new Error(`Not a BCS line (line ${index + 1}): ${JSON.stringify(line.slice(0, 60))}`);
        const [, content, marker] = match;
        const fields: Field[] = [];
        let consumed = 0;
        let spacesInFields = 0;
        FIELDS.lastIndex = 0;
        for (let field = FIELDS.exec(content!); field; field = FIELDS.exec(content!)) {
            if (field[1] !== undefined) fields.push({ kind: "int", value: Number(field[1]) });
            else if (field[2] !== undefined) fields.push({ kind: "string", value: field[2] });
            else fields.push({ kind: "group", values: field[3]!.split(/[.,]/).map(Number) });
            consumed += field[0].length;
            spacesInFields += countSpaces(field[0]);
        }
        // Everything the fields did not account for has to be the separators the writer puts back.
        if (content!.replaceAll(/\s/g, "").length !== consumed - spacesInFields) {
            throw new Error(`Unreadable BCS fields (line ${index + 1}): ${JSON.stringify(line.slice(0, 60))}`);
        }
        tokens.push({
            marker: marker as Marker,
            fields,
            ints: fields.flatMap((f) => (f.kind === "int" ? [f.value] : [])),
            strings: fields.flatMap((f) => (f.kind === "string" ? [f.value] : [])),
            line: index + 1,
        });
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

/**
 * Splits an object's fields into their parts by POSITION, which is what lets one reader serve every engine.
 * Numbers before the rectangle-or-name are the targets and identifier chain; the chain is always the last
 * five of them, so nothing here has to know which game produced the file. IWD2 puts two more numbers after
 * the name, and those keep their own slot rather than being folded in front.
 */
function objectFromFields(fields: readonly Field[]): BcsObject {
    const ints: number[] = [];
    const trailingInts: number[] = [];
    let region: number[] | undefined;
    let text = "";
    let named = false;
    for (const field of fields) {
        if (field.kind === "group") region = field.values;
        else if (field.kind === "string") {
            text = field.value;
            named = true;
        } else (named ? trailingInts : ints).push(field.value);
    }
    return {
        ints,
        ...(region === undefined ? {} : { region }),
        string: text,
        ...(trailingInts.length === 0 ? {} : { trailingInts }),
    };
}

function readObject(cursor: Cursor): BcsObject {
    cursor.take("OB");
    const close = cursor.take("OB");
    return objectFromFields(close.fields);
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
    // A PST trigger carries a point among its numbers; every other engine's has none.
    const point = head.fields.find((f) => f.kind === "group");
    return {
        ints: head.ints,
        ...(point === undefined ? {} : { point: point.values }),
        strings: head.strings,
        object: objectFromFields(close.fields),
    };
}

function readAction(cursor: Cursor): BcsAction {
    cursor.take("AC");
    const idToken = cursor.peek();
    if (!idToken || idToken.marker !== "OB") throw new Error(`Expected an action id at line ${idToken?.line ?? "end"}`);
    cursor.take("OB");
    const first = cursor.take("OB");
    const objects: BcsObject[] = [objectFromFields(first.fields)];
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
