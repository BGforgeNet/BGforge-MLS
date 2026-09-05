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

export interface NotesOptions {
    /** The animation id the converted set is to be declared under. */
    targetId: number;
}

/** A plan that goes ahead. A refusal writes nothing at all, so it has no notes to write. */
export type PlannedConversion = Exclude<ConversionPlan, { outcome: "refused" }>;

function hex(id: number): string {
    return `0x${id.toString(16).padStart(4, "0")}`;
}

/** Every file the set draws, each named once, in read order. */
function resrefs(set: NeutralSet): string[] {
    const seen = new Set<string>();
    for (const variant of set.variants) for (const resref of variant.files.keys()) seen.add(resref);
    return [...seen];
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
        `- The id ${id} is assumed, not allocated - check it is free before declaring it.`,
    ];
}

export function conversionNotes(
    set: NeutralSet,
    target: ConversionTarget,
    plan: PlannedConversion,
    options: NotesOptions,
): string {
    const id = hex(options.targetId);
    const losses = new Set(plan.report.losses);
    const lines = [
        `# ${set.identity.name || set.identity.code || hex(set.identity.sourceId)}`,
        "",
        `Converted to: ${target.label}`,
        "",
        "## Declare by hand",
        "",
        ...declarationLines(set, target, id),
        "",
        "## Source",
        "",
        `- Game \`${set.identity.sourceFlavour}\`, animation ${hex(set.identity.sourceId)}`,
        `- Section \`${set.identity.sourceSection ?? "none declared"}\``,
        `- Files: ${resrefs(set).join(", ")}`,
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
