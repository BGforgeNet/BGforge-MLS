/**
 * Writes a BCS tree back out.
 *
 * A line is a run of fields followed by the marker that opens or closes the next block, with no separator.
 * The spacing inside that run is per record and not uniform - an object writes a space before its quoted
 * field and none after it, a trigger writes one on both sides of its pair, an action writes none before the
 * first - so it is reproduced from the record's kind rather than carried on the tree. Those are every shape
 * that occurs across 1.46 million field lines in 4939 real scripts, and reproducing them is what lets an
 * edited script come back out looking like one the game wrote.
 */

import type { BcsAction, BcsObject, BcsResponse, BcsScript, BcsTrigger } from "./types";

/** `<ints> "<string>"` then the marker, with no space before it. */
function objectFields(object: BcsObject): string {
    return `${object.ints.join(" ")} ${quote(object.string)}`;
}

/** `"a" "b" ` - a trigger writes a space on both sides of its pair, an action only after. */
function quotedPair(strings: string[], leadingSpace: boolean): string {
    if (strings.length === 0) return "";
    return `${leadingSpace ? " " : ""}${strings.map((s) => quote(s)).join(" ")} `;
}

function quote(text: string): string {
    return `"${text}"`;
}

class Writer {
    private readonly parts: string[] = [];
    /** Fields waiting for the marker they precede - `100AC` is a weight that found its action's opener. */
    private pending = "";

    marker(marker: string): void {
        this.parts.push(`${this.pending}${marker}\n`);
        this.pending = "";
    }

    fields(text: string): void {
        this.pending = text;
    }

    done(): string {
        if (this.pending !== "") throw new Error(`Cannot write BCS: fields with no marker after them`);
        return this.parts.join("");
    }
}

function writeObject(writer: Writer, object: BcsObject): void {
    writer.marker("OB");
    writer.fields(objectFields(object));
    writer.marker("OB");
}

function writeTrigger(writer: Writer, trigger: BcsTrigger): void {
    writer.marker("TR");
    // The trigger's own fields ride on its object's opening marker, which is why `16412 0OB` is one line.
    writer.fields(`${trigger.ints.join(" ")}${quotedPair(trigger.strings, true)}`);
    writeObject(writer, trigger.object);
    writer.marker("TR");
}

function writeAction(writer: Writer, action: BcsAction): void {
    writer.marker("AC");
    // Same shape as a trigger: the id rides on the first object's opening marker.
    writer.fields(String(action.id));
    for (const object of action.objects) writeObject(writer, object);
    writer.fields(`${action.ints.join(" ")}${quotedPair(action.strings, false)}`);
    writer.marker("AC");
}

function writeResponse(writer: Writer, response: BcsResponse): void {
    writer.marker("RE");
    writer.fields(String(response.weight));
    for (const action of response.actions) writeAction(writer, action);
    writer.marker("RE");
}

export function writeBcs(script: BcsScript): string {
    const writer = new Writer();
    writer.marker("SC");
    for (const block of script.blocks) {
        writer.marker("CR");
        writer.marker("CO");
        for (const trigger of block.triggers) writeTrigger(writer, trigger);
        writer.marker("CO");
        writer.marker("RS");
        for (const response of block.responses) writeResponse(writer, response);
        writer.marker("RS");
        writer.marker("CR");
    }
    writer.marker("SC");
    return writer.done();
}
