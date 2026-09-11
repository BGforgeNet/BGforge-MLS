/**
 * The files a converted set needs BESIDE its art, precomputed rather than described.
 *
 * A conversion used to write art and a notes file telling the reader what to declare by hand. Everything
 * in those instructions is already known here - the id, the stem, the family, whether the east is stored -
 * so the instructions can be the files themselves. The notes stay, because a reader still has to put these
 * where their install or their mod wants them, and because the losses have nowhere else to go.
 *
 * Nothing here is written INTO an install. These land beside the art in the folder the reader chose, which
 * is the same rule the art follows: a converted set is an animation nothing declares yet, and dropping
 * files into a game that no table names is what the notes exist to avoid.
 */
import { type ActionScheme } from "../animation-schemes/actions";
import { declarationFor } from "../animation-ini";
import { writeAnimationIni } from "../animation-ini-write";
import { type ConversionTarget } from "./target";

/** One precomputed file: what to call it, and what goes in it. */
export interface DeclarationFile {
    name: string;
    text: string;
}

export interface DeclarationInput {
    target: ConversionTarget;
    /** The id the set is to be declared under. */
    targetId: number;
    /** The stem its files are named from. */
    prefix: string;
    /** The family to declare. Empty where nothing named one, which is why there may be no file at all. */
    section: string;
    /** Armour levels the written set has, where its naming carries them. */
    armourLevels?: number;
    /**
     * How the conversion named its files, which is what the declared file-scheme flag states.
     *
     * The flag is about the SCHEME and nothing else: the documentation gives it the same meaning for every
     * type that carries one, 0 packing the animation into `G1` and `G2` and 1 spreading it over subfiles.
     */
    naming: ActionScheme;
}

/** Which namings write one file per action, and so declare the spread scheme rather than the packed one. */
function spreadsOverSubfiles(naming: ActionScheme): boolean {
    return naming !== "cycle-numbers";
}

/** An animation's declaration is read as its id in hex - `6006.ini` for `0x6006`. */
export function iniName(id: number): string {
    return `${id.toString(16).padStart(4, "0")}.ini`;
}

/**
 * The Fallout art list rows, as text to append.
 *
 * The engine appends each two-letter code itself, so these are the stems rather than the written files,
 * and each row's POSITION in that list is the art index a critter's prototype points at - which is why
 * this is a fragment to merge rather than a file to drop in.
 */
function critterRows(input: DeclarationInput): DeclarationFile {
    return {
        name: `${input.prefix}-critters.txt`,
        text: [
            `# Add to ART/CRITTERS/CRITTERS.LST. Each row's position is the art index a prototype points at.`,
            input.prefix.toUpperCase(),
            "",
        ].join("\n"),
    };
}

/** Every file a reader needs beside the art, for whichever engine the set was written for. */
export function declarationFiles(input: DeclarationInput): DeclarationFile[] {
    if (input.target.declaration === "fallout-art-list") return [critterRows(input)];
    if (input.target.declaration !== "infinity-ids") return [];
    // Nothing rather than a file headed `[]`: a declaration names a family, and one naming none parses as
    // no family at all while looking like a declaration. The notes beside the art say what is missing.
    if (input.section === "") return [];
    return [
        {
            name: iniName(input.targetId),
            text: writeAnimationIni({
                // The install's own vocabulary, not this project's: one family is named by a header the
                // install never writes, and declaring it under that name declares nothing at all.
                ...declarationFor(input.section),
                resref: input.prefix.toUpperCase(),
                // From the NAMING, which is what this flag states. It carried the direction profile's
                // "store the east" axis before, and the two are unrelated: whether an eastern companion
                // exists is fixed by the declared section's own type and no flag can move it, while this
                // one tells the engine which filenames to build. Read off the wrong axis it sent the
                // engine after names the conversion never wrote.
                splitBams: spreadsOverSubfiles(input.naming),
                ...(input.armourLevels === undefined ? {} : { armorMax: input.armourLevels }),
            }),
        },
    ];
}
