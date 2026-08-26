/**
 * Infinity Engine DLG V1 parser.
 *
 * A DLG is a dialog state machine: a state table, a transition table, and three (offset,length) tables
 * addressing a trailing block of trigger and action text. The text is stored verbatim - the same
 * trigger and action fragments a `.d` file wraps in tildes - so reading a dialog's conditions needs no
 * compiler and no open install. Only the spoken text is external, held as strrefs into `dialog.tlk`.
 */

import { group, readerAt } from "../ie-common/parse-helpers";
import { type DlgBuildInput, writeRecord } from "./build";
import { encodeOpaqueRange } from "../opaque-range";
import { walkStruct } from "../spec/walk-display";
import type { BinaryParser, ParseOptions, ParseResult } from "../types";
import type { DlgCanonicalDocument } from "./canonical-schemas";
import {
    dlgHeaderInterruptSchema,
    dlgHeaderSchema,
    dlgStateSchema,
    dlgTextRefSchema,
    dlgTransitionSchema,
} from "./schemas";
import {
    DLG_HEADER_SIZE,
    DLG_HEADER_WITH_INTERRUPT_SIZE,
    dlgHeaderInterruptSpec,
    dlgHeaderSpec,
    type DlgHeaderData,
    type DlgHeaderInterruptData,
} from "./specs/header";
import { DLG_STATE_SIZE, dlgStateSpec, type DlgStateData } from "./specs/state";
import { DLG_TEXT_REF_SIZE, type DlgTextRefData } from "./specs/text-ref";
import { DLG_TRANSITION_SIZE, dlgTransitionSpec, type DlgTransitionData } from "./specs/transition";

const TEXT_BLOCK_LABEL = "text";

const FORMAT_ID = "dlg";
const FORMAT_NAME = "Infinity Engine DLG v1";
const DLG_SIGNATURE = "DLG ";
const DLG_VERSION_V1 = "V1.0";

/**
 * Canonical slugs for the transition flags, as `compileFlagTable` derives them from the spec's display
 * names. The wire int projects to a sorted `string[]` of these (spec rule: flag words are flat name
 * arrays in canonical form), so membership rather than bit arithmetic is what reads a transition.
 */
export const DlgTransitionFlag = {
    Text: "text",
    Trigger: "trigger",
    Action: "action",
    TerminatesDialog: "terminatesDialog",
    JournalEntry: "journalEntry",
    Interrupt: "interrupt",
    AddUnsolvedQuest: "addUnsolvedQuest",
    AddJournalNote: "addJournalNote",
    AddSolvedQuest: "addSolvedQuest",
    ImmediateExecution: "immediateExecution",
    ClearActions: "clearActions",
} as const;

export interface DlgState extends DlgStateData {}

export interface DlgTransition extends DlgTransitionData {
    // Named readings of `flags`. The wire fields stay verbatim - every one of them must round-trip
    // whether or not its bit is set - so these say which of them carry meaning.
    hasText: boolean;
    hasTrigger: boolean;
    hasAction: boolean;
    hasJournalEntry: boolean;
    /** When true the transition ends the conversation and carries no next-node information. */
    terminatesDialog: boolean;
}

export interface Dlg {
    signature: string;
    version: string;
    states: DlgState[];
    transitions: DlgTransition[];
    /** Trigger expressions, indexed by `DlgState.triggerIndex`. */
    stateTriggers: string[];
    /** Trigger expressions, indexed by `DlgTransition.triggerIndex`. */
    transitionTriggers: string[];
    /** Action lists, indexed by `DlgTransition.actionIndex`. */
    actions: string[];
}

/** Reads N bytes verbatim, one byte per character, matching how the spec system surfaces `chars` fields. */
function latin1(bytes: Uint8Array, at: number, length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += String.fromCodePoint(bytes[at + i]!);
    return out;
}

function readRecords<T>(
    bytes: Uint8Array,
    schema: { read: (reader: ReturnType<typeof readerAt>) => T },
    tableOffset: number,
    count: number,
    stride: number,
): T[] {
    const out: T[] = [];
    for (let i = 0; i < count; i++) out.push(schema.read(readerAt(bytes, tableOffset + i * stride)));
    return out;
}

export interface DlgSections {
    header: DlgHeaderData;
    /** Present only in post-BG1 files - see `headerSizeOf`. */
    headerInterrupt?: DlgHeaderInterruptData;
    states: DlgStateData[];
    transitions: DlgTransitionData[];
    stateTriggerRefs: DlgTextRefData[];
    transitionTriggerRefs: DlgTextRefData[];
    actionRefs: DlgTextRefData[];
}

/**
 * Whether the file carries the interrupt-flags dword at 0x30, and so how long its header is.
 *
 * The version string does not distinguish the two forms - both say V1.0 - so the discriminator is where
 * the tables start: the dword at 0x30 belongs to the header only if no table begins before 0x34. An offset
 * of 0 addresses no table and is read as unset rather than as a table at byte 0.
 */
export function headerSizeOf(bytes: Uint8Array, header: DlgHeaderData): number {
    if (bytes.byteLength < DLG_HEADER_WITH_INTERRUPT_SIZE) return DLG_HEADER_SIZE;
    const offsets = [
        header.stateTableOffset,
        header.transitionTableOffset,
        header.stateTriggerTableOffset,
        header.transitionTriggerTableOffset,
        header.actionTableOffset,
    ].filter((o) => o > 0);
    if (offsets.length === 0) return DLG_HEADER_WITH_INTERRUPT_SIZE;
    return Math.min(...offsets) < DLG_HEADER_WITH_INTERRUPT_SIZE ? DLG_HEADER_SIZE : DLG_HEADER_WITH_INTERRUPT_SIZE;
}

/**
 * Decodes every section a DLG addresses, refusing one that does not fit before reading any of it.
 *
 * The bounds live here rather than at a caller because an overrunning offset or count otherwise surfaces as a
 * bare `RangeError` out of the DataView, naming neither the file nor the section - so `readDlg` and the
 * parser cannot give different answers about the same file.
 */
function readSections(bytes: Uint8Array): DlgSections {
    if (bytes.byteLength < DLG_HEADER_SIZE) {
        throw new Error(`Truncated DLG: ${bytes.byteLength} bytes, need at least ${DLG_HEADER_SIZE}`);
    }
    const header: DlgHeaderData = dlgHeaderSchema.read(readerAt(bytes, 0));
    const hasInterrupt = headerSizeOf(bytes, header) === DLG_HEADER_WITH_INTERRUPT_SIZE;
    const tablesOverrun = firstOverrun(headerSections(header, hasInterrupt), bytes.byteLength);
    if (tablesOverrun !== undefined) throw new Error(`Truncated DLG: ${tablesOverrun}`);

    const headerInterrupt = hasInterrupt
        ? (dlgHeaderInterruptSchema.read(readerAt(bytes, DLG_HEADER_SIZE)) as DlgHeaderInterruptData)
        : undefined;
    const sections: DlgSections = {
        header,
        ...(headerInterrupt && { headerInterrupt }),
        states: readRecords(bytes, dlgStateSchema, header.stateTableOffset, header.stateCount, DLG_STATE_SIZE),
        transitions: readRecords(
            bytes,
            dlgTransitionSchema,
            header.transitionTableOffset,
            header.transitionCount,
            DLG_TRANSITION_SIZE,
        ),
        stateTriggerRefs: readRecords(
            bytes,
            dlgTextRefSchema,
            header.stateTriggerTableOffset,
            header.stateTriggerCount,
            DLG_TEXT_REF_SIZE,
        ),
        transitionTriggerRefs: readRecords(
            bytes,
            dlgTextRefSchema,
            header.transitionTriggerTableOffset,
            header.transitionTriggerCount,
            DLG_TEXT_REF_SIZE,
        ),
        actionRefs: readRecords(
            bytes,
            dlgTextRefSchema,
            header.actionTableOffset,
            header.actionCount,
            DLG_TEXT_REF_SIZE,
        ),
    };
    // The text refs address bytes the tables name, so they can only be checked once the tables are decoded.
    const refsOverrun = firstOverrun(refSections(sections), bytes.byteLength);
    if (refsOverrun !== undefined) throw new Error(`Truncated DLG: ${refsOverrun}`);
    return sections;
}

/** First byte past every decoded section, which is where a file with no text block ends. */
export function sectionsEnd(sections: DlgSections): number {
    const h = sections.header;
    return Math.max(
        sections.headerInterrupt ? DLG_HEADER_WITH_INTERRUPT_SIZE : DLG_HEADER_SIZE,
        h.stateTableOffset + h.stateCount * DLG_STATE_SIZE,
        h.transitionTableOffset + h.transitionCount * DLG_TRANSITION_SIZE,
        h.stateTriggerTableOffset + h.stateTriggerCount * DLG_TEXT_REF_SIZE,
        h.transitionTriggerTableOffset + h.transitionTriggerCount * DLG_TEXT_REF_SIZE,
        h.actionTableOffset + h.actionCount * DLG_TEXT_REF_SIZE,
    );
}

/**
 * First byte of the trailing text block: the lowest offset any text ref points at. Everything from there to
 * EOF is text plus whatever slack the producer left - a 4286-file corpus has none, but the range is taken to
 * EOF rather than to the last ref so that any would survive. With no refs at all there is no text block and
 * the file ends after its tables.
 */
function textBlockStart(sections: DlgSections): number {
    const offsets = [...sections.stateTriggerRefs, ...sections.transitionTriggerRefs, ...sections.actionRefs].map(
        (r) => r.offset,
    );
    return offsets.length ? Math.min(...offsets) : sectionsEnd(sections);
}

/**
 * Reads a DLG into the logical view a dialog consumer wants: text tables resolved, flag bits named.
 * `dlgParser.parse` is the editor-facing entry point; this is the direct one.
 */
export function readDlg(bytes: Uint8Array): Dlg {
    const sections = readSections(bytes);
    const resolve = (refs: DlgTextRefData[]): string[] => refs.map((r) => latin1(bytes, r.offset, r.length));

    return {
        signature: latin1(bytes, 0x00, 4),
        version: latin1(bytes, 0x04, 4),
        states: sections.states,
        transitions: sections.transitions.map((t) => {
            const set = new Set(t.flags);
            return {
                ...t,
                hasText: set.has(DlgTransitionFlag.Text),
                hasTrigger: set.has(DlgTransitionFlag.Trigger),
                hasAction: set.has(DlgTransitionFlag.Action),
                hasJournalEntry: set.has(DlgTransitionFlag.JournalEntry),
                terminatesDialog: set.has(DlgTransitionFlag.TerminatesDialog),
            };
        }),
        stateTriggers: resolve(sections.stateTriggerRefs),
        transitionTriggers: resolve(sections.transitionTriggerRefs),
        actions: resolve(sections.actionRefs),
    };
}

class DlgParser implements BinaryParser {
    readonly id = FORMAT_ID;
    readonly name = FORMAT_NAME;
    readonly extensions = ["dlg"];
    readonly family = "infinity-engine" as const;

    private fail(message: string): ParseResult {
        return { format: this.id, formatName: this.name, root: group("DLG File", []), errors: [message] };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        // The floor is the BG1-era header: a shorter file cannot even carry the table offsets.
        if (data.byteLength < DLG_HEADER_SIZE) {
            return this.fail(`Truncated DLG: ${data.byteLength} bytes, need at least ${DLG_HEADER_SIZE}`);
        }
        const signature = latin1(data, 0, 4);
        if (signature !== DLG_SIGNATURE) {
            return this.fail(`Not a DLG file: signature ${JSON.stringify(signature)}`);
        }
        const version = latin1(data, 4, 4);
        if (version !== DLG_VERSION_V1) {
            return this.fail(`Unsupported DLG version: ${JSON.stringify(version)} (only V1.0 is supported)`);
        }

        // The two header lengths are both normal - 1002 of the 4286 DLGs in a stock BG:EE plus BG2:ToB pair
        // carry the shorter one - so the variant is recorded on the document (`headerInterrupt` absent) and
        // not warned about. A writer reads it there; re-emitting the field would move every table.
        // `readSections` owns the bounds, so a file this reports on is exactly a file `readDlg` refuses.
        let sections: DlgSections;
        try {
            sections = readSections(data);
        } catch (error) {
            return this.fail(error instanceof Error ? error.message : String(error));
        }

        const document: DlgCanonicalDocument = sections;
        const h = sections.header;
        const textStart = textBlockStart(sections);
        const textRange = encodeOpaqueRange(TEXT_BLOCK_LABEL, data, textStart, data.byteLength);

        return {
            format: this.id,
            formatName: this.name,
            variantId: "dialog",
            root: group("DLG File", [
                group("DLG Header", [
                    walkStruct(dlgHeaderSpec, {}, 0, h, "DLG Header"),
                    ...(sections.headerInterrupt
                        ? [
                              walkStruct(
                                  dlgHeaderInterruptSpec,
                                  {},
                                  DLG_HEADER_SIZE,
                                  sections.headerInterrupt,
                                  "Interrupt",
                              ),
                          ]
                        : []),
                ]),
                group(
                    "States",
                    sections.states.map((s, i) =>
                        walkStruct(dlgStateSpec, {}, h.stateTableOffset + i * DLG_STATE_SIZE, s, `State ${i}`),
                    ),
                ),
                group(
                    "Transitions",
                    sections.transitions.map((t, i) =>
                        walkStruct(
                            dlgTransitionSpec,
                            {},
                            h.transitionTableOffset + i * DLG_TRANSITION_SIZE,
                            t,
                            `Transition ${i}`,
                        ),
                    ),
                ),
            ]),
            document,
            // The text block's layout is not derivable from its contents (see canonical-schemas.ts), so it
            // travels as an opaque range: that is what lets a JSON snapshot reconstruct the file, and what
            // the serializer rebuilds onto.
            // A dialog with no triggers and no actions has no text block at all, and `encodeOpaqueRange`
            // returns undefined for the empty range rather than an empty one.
            opaqueRanges: textRange ? [textRange] : undefined,
            sourceData: data,
        };
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeDlg(result);
    }
}

/**
 * Every section a write would touch has to lie inside the file. The JSON-snapshot path can arrive with a
 * hand-edited document (`fgbin --load`), and a header whose counts or refs address bytes that are not there
 * produces a DLG that overruns in every reader - so it is refused rather than written.
 */
function assertFits(document: DlgCanonicalDocument, size: number): void {
    const overrun =
        firstOverrun(headerSections(document.header, document.headerInterrupt !== undefined), size) ??
        firstOverrun(refSections(document), size);
    if (overrun !== undefined) throw new Error(`Cannot serialize DLG: ${overrun}`);
}

/**
 * Every span the header addresses, as `[what, offset, length]`.
 *
 * Shared by the parse-time refusal and the write-time one so a file refused on open cannot be a file accepted
 * on save. The header itself is included: a BG1-era file whose first table starts at 0x30 has no room for the
 * interrupt dword, and a document claiming both is describing bytes that overlap.
 */
function headerSections(header: DlgHeaderData, hasInterrupt: boolean): [string, number, number][] {
    return [
        ["header", 0, hasInterrupt ? DLG_HEADER_WITH_INTERRUPT_SIZE : DLG_HEADER_SIZE],
        ["state table", header.stateTableOffset, header.stateCount * DLG_STATE_SIZE],
        ["transition table", header.transitionTableOffset, header.transitionCount * DLG_TRANSITION_SIZE],
        ["state trigger table", header.stateTriggerTableOffset, header.stateTriggerCount * DLG_TEXT_REF_SIZE],
        [
            "transition trigger table",
            header.transitionTriggerTableOffset,
            header.transitionTriggerCount * DLG_TEXT_REF_SIZE,
        ],
        ["action table", header.actionTableOffset, header.actionCount * DLG_TEXT_REF_SIZE],
    ];
}

/** Every span the text refs address, which only a file whose tables have already been read can supply. */
function refSections(document: DlgCanonicalDocument): [string, number, number][] {
    const lists: [string, DlgTextRefData[]][] = [
        ["state trigger", document.stateTriggerRefs],
        ["transition trigger", document.transitionTriggerRefs],
        ["action", document.actionRefs],
    ];
    return lists.flatMap(([name, list]) =>
        list.map((ref, i): [string, number, number] => [`${name} ${i}`, ref.offset, ref.length]),
    );
}

/** The first span that does not lie inside `size`, as the sentence to report it with. */
function firstOverrun(sections: readonly [string, number, number][], size: number): string | undefined {
    for (const [name, offset, length] of sections) {
        if (offset < 0 || length < 0 || offset + length > size) {
            return `${name} does not fit - ${offset}+${length} in ${size} bytes`;
        }
    }
    return undefined;
}

/**
 * Re-emits the decoded structures over a copy of the source bytes, each section written at its own stored
 * offset. Anything not covered by a decoded section - the text block above all - is preserved exactly.
 *
 * This cannot grow the file, so it serves editing decoded fields and not yet inserting states. Building a
 * DLG from nothing is the construction API's job and needs a layout policy this deliberately does not
 * invent.
 */
export function serializeDlg(result: ParseResult): Uint8Array {
    const document = result.document as DlgCanonicalDocument | undefined;
    if (!document) throw new Error("Cannot serialize DLG: parse result carries no canonical document");
    if (!result.sourceData) throw new Error("Cannot serialize DLG: parse result carries no source bytes");

    const out = new Uint8Array(result.sourceData);
    const h = document.header;
    assertFits(document, out.byteLength);
    writeRecord(out, dlgHeaderSchema, 0, h);
    if (document.headerInterrupt) {
        writeRecord(out, dlgHeaderInterruptSchema, DLG_HEADER_SIZE, document.headerInterrupt);
    }
    document.states.forEach((s, i) => writeRecord(out, dlgStateSchema, h.stateTableOffset + i * DLG_STATE_SIZE, s));
    document.transitions.forEach((t, i) =>
        writeRecord(out, dlgTransitionSchema, h.transitionTableOffset + i * DLG_TRANSITION_SIZE, t),
    );
    document.stateTriggerRefs.forEach((r, i) =>
        writeRecord(out, dlgTextRefSchema, h.stateTriggerTableOffset + i * DLG_TEXT_REF_SIZE, r),
    );
    document.transitionTriggerRefs.forEach((r, i) =>
        writeRecord(out, dlgTextRefSchema, h.transitionTriggerTableOffset + i * DLG_TEXT_REF_SIZE, r),
    );
    document.actionRefs.forEach((r, i) =>
        writeRecord(out, dlgTextRefSchema, h.actionTableOffset + i * DLG_TEXT_REF_SIZE, r),
    );

    return out;
}

/**
 * A parsed file's content, ready to hand back to `buildDlg` - the seam an edit sits in. Everything the
 * header derives from the content is dropped, so an edit cannot leave a count or offset behind.
 */
export function toDlgBuildInput(bytes: Uint8Array): DlgBuildInput {
    const dlg = readDlg(bytes);
    const { headerInterrupt } = readSections(bytes);
    return {
        states: dlg.states,
        transitions: dlg.transitions,
        stateTriggers: dlg.stateTriggers,
        transitionTriggers: dlg.transitionTriggers,
        actions: dlg.actions,
        ...(headerInterrupt && { interrupt: headerInterrupt }),
    };
}

export { buildDlg, type DlgBuildInput } from "./build";

export const dlgParser = new DlgParser();
