/**
 * The prose file written beside a converted set.
 *
 * It exists because declaring an animation is a MERGE into tables the whole install shares, not a file
 * write. The tool could write `ANIMATE.IDS` and `ANISND.IDS` - both are mapped resource types and a write
 * lands in `override/` - but an override copy shadows the archived table wholesale and collides with the
 * next mod that edits it. So the rows are stated for a human (or an installer) to merge.
 *
 * Terse on purpose: it sits next to the output and a page of prose is one nobody reads.
 *
 * No tags are emitted. The obvious source for them is the animation's name, and a name is prose - reading
 * "cleric" out of `CLERIC_MALE_GNOME` is the inference the rest of this package refuses to make. The
 * section is printed instead, which is what the install actually declared.
 */
import { type ConversionPlan } from "./plan";
import { type ConversionTarget } from "./target";
import { type NeutralSet } from "../neutral/model";
import { animationIdHex, setTitle } from "../animation-index";

export interface NotesOptions {
    /** The animation id the converted set is to be declared under. */
    targetId: number;
}

/** A plan that goes ahead. A refusal writes nothing at all, so it has no notes to write. */
export type PlannedConversion = Exclude<ConversionPlan, { outcome: "refused" }>;

/** Every file the set draws, each named once, in read order. */
function resrefs(set: NeutralSet): string[] {
    const seen = new Set<string>();
    for (const variant of set.variants) for (const resref of variant.files.keys()) seen.add(resref);
    return [...seen];
}

/**
 * What the source's actions depict, each named once.
 *
 * The codes rather than the display labels: a code is what the source's filenames carry and what a reader
 * checking this against an archive listing sees, and the term beside it is what the conversion matched on.
 * An unpinned code is printed bare, which is the same statement the vocabulary makes - nobody has said what
 * this one is.
 */
function actionSummary(set: NeutralSet): string {
    const seen = new Map<string, string>();
    for (const variant of set.variants) {
        for (const action of variant.actions) {
            const { code, id, detail } = action.action;
            if (seen.has(code)) continue;
            seen.set(code, id === "unpinned" ? code : `${code} (${detail === undefined ? id : `${id}, ${detail}`})`);
        }
    }
    return [...seen.values()].join(", ");
}

/**
 * The rows to merge by hand, for a target whose declaration step this tool models.
 *
 * An unmodelled target says so rather than printing nothing: an absent section reads as "nothing to
 * declare", which is a stronger claim than anything here has checked.
 */
function declarationLines(set: NeutralSet, target: ConversionTarget, id: string): string[] {
    if (target.declaration === "unmodelled") {
        return [`- How ${target.label} declares an animation is not modelled here - check its own requirements.`];
    }
    return [
        `- \`ANIMATE.IDS\`: \`${id} ${set.identity.name}\``,
        `- \`ANISND.IDS\`: \`${id} ${set.identity.code}\``,
        // Provenance of the id is the caller's, not this function's, so the line claims neither - and the
        // confirmation is worth asking for either way: an override or a mod can claim an id no index saw.
        `- Confirm nothing else in the target claims ${id}.`,
    ];
}

export function conversionNotes(
    set: NeutralSet,
    target: ConversionTarget,
    plan: PlannedConversion,
    options: NotesOptions,
): string {
    const id = animationIdHex(options.targetId);
    const losses = new Set(plan.report.losses);
    const lines = [
        `# ${setTitle({ id: set.identity.sourceId, code: set.identity.code, name: set.identity.name })}`,
        "",
        `Converted to: ${target.label}`,
        "",
        "## Declare by hand",
        "",
        ...declarationLines(set, target, id),
        "",
        "## Source",
        "",
        `- Game \`${set.identity.sourceFlavour}\`, animation ${animationIdHex(set.identity.sourceId)}`,
        `- Section \`${set.identity.sourceSection ?? "none declared"}\``,
        `- Files: ${resrefs(set).join(", ")}`,
        `- Actions: ${actionSummary(set)}`,
        "",
        "## Result",
        "",
    ];
    // Losses and notes are labelled apart rather than listed together: the split is the whole point of the
    // report, and a reader who cannot see which is which has to re-derive it from the kind names.
    for (const item of plan.report.items) {
        lines.push(`- ${losses.has(item) ? "loss" : "note"} - ${item.kind}: ${item.detail}`);
    }
    if (plan.report.items.length > 0) lines.push("");
    lines.push(plan.report.lossless ? "Lossless." : `${plan.report.losses.length} loss(es) above.`);
    return `${lines.join("\n")}\n`;
}
