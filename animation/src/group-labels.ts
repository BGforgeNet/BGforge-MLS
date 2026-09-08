/**
 * Names for the direction blocks a multi-block IE animation file packs, and what each block depicts.
 *
 * A BAM stores no sequence names, so the filename's trailing sequence token plus the block scheme is the
 * only in-reach source. Kept as its own entry point rather than in the barrel: the animation editor's
 * webview needs these names, and the barrel reaches the image library's Node-only codecs through the
 * stance reader.
 *
 * The block's MEANING is stated here as data beside its name rather than parsed out of it: a converter
 * that read "WK" off the front of a label would be inferring from a display string, and the two would
 * drift the first time a label was reworded.
 */
import { type IeScheme } from "@bgforge/image/ie-direction";
import { type NeutralActionId, decodeActionCode } from "./animation-schemes/actions";
import { type ModelledSection } from "./animation-schemes/layout";

/**
 * The engine's whole sequence vocabulary, and the word each code is shown as.
 *
 * CLOSED, and that is the point. A block table entry names its band by CODE and the display name is
 * derived here, so a band cannot be given an invented name, a number, or no name at all without failing
 * to compile. It used to be a free string with a numbered fallback underneath, and a whole family of
 * tiled animations shipped reading "G2 - group 1" with nothing to notice - the fallback absorbed every
 * layout the table had not been taught, silently.
 *
 * Names follow the published `SEQ_` list. `A5` is the one entry that list does not carry: it appears as a
 * real block in shipped layouts, marked uncertain, so its wording is this project's own reading.
 */
const SEQUENCES = {
    WK: "walk",
    SC: "combat ready",
    SD: "stand",
    GH: "get hit",
    DE: "die",
    TW: "twitch",
    SL: "sleep",
    GU: "get up",
    // Every attack code shares one word, and what tells two apart rides on the ENTRY: the same code means
    // different things per family - `A2` is the second strike of a monster and a two-handed slash of a
    // character - so a per-code name could only ever be right for one of them.
    A1: "attack",
    A2: "attack",
    A3: "attack",
    A4: "attack",
    A5: "attack",
    CA: "cast spell",
    SP: "conjure spell",
    EMERGE: "emerge",
    HIDE: "hide",
} as const satisfies Record<string, string>;

export type SequenceCode = keyof typeof SEQUENCES;

/**
 * Re-exported because this module is what a browser bundle reaches for the naming vocabulary, and the
 * strikes behind `A1`-`A9` are one table two surfaces read - the block labels below, and the webview's
 * decode of a filename. Keeping a second copy over there is how the two came to name `A1` differently.
 */
export { decodeActionCode } from "./animation-schemes/actions";

/**
 * One block of a packed file.
 *
 * Two shapes and no third: a block either names the sequences the engine plays it for, or declares that
 * the scheme addresses none to it. There is deliberately no way to spell "a block whose name I do not
 * know" - a layout this table has not been taught is absent from it entirely, which the caller reports as
 * a numbered group, rather than half-described here.
 */
export type IeGroup = NamedBlock | UnusedBlock;

interface NamedBlock {
    /**
     * Every sequence this band is played for, in the order the documentation lists them.
     *
     * More than one where the engine shares a band - a dragon's idle serves stand, combat stance AND the
     * conjure it holds. Non-empty by construction: the tuple type is what makes an unnamed band unwritable.
     */
    codes: readonly [SequenceCode, ...SequenceCode[]];
    /** Absent where the documentation names the block without pinning what it is - see `CAST_BLOCKS`. */
    id?: NeutralActionId;
    /**
     * The grip, weapon or strike this block pins, where its family pins one - "Attack (slash)".
     *
     * Parenthesised, where `ordinal` is bare. That split is not cosmetic: a family that merely REPEATS a
     * stance numbers it, and a family that distinguishes one names it, so the two read differently on
     * purpose and cannot be collapsed into a single free string without losing which is which.
     */
    detail?: string;
    /** Which repeat of the stance this is, where a family ships several - "Stand 2". */
    ordinal?: number;
    unused?: never;
}

interface UnusedBlock {
    /**
     * The scheme addresses no sequence to this block.
     *
     * Set only where the documentation says so, and distinct from a block whose name is merely unknown: a
     * file must carry every block up to the last one it draws, so an unaddressed one is padding the format
     * forces on it. It still holds a frame per facing and so passes the does-this-draw test, which is why
     * saying it here is the only way a stance list can leave it out.
     */
    unused: true;
    codes?: never;
    id?: never;
    detail?: never;
    ordinal?: never;
}

function capitalized(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** `a`, `a or b`, `a, b or c` - a shared band reads as the list of sequences it is played for. */
function joined(parts: readonly string[]): string {
    if (parts.length <= 1) return parts[0] ?? "";
    return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

/**
 * The block's own qualifiers around a name.
 *
 * They qualify the BAND, so a shared band carries them on every sequence it is played for rather than on
 * one of them.
 */
function qualified(base: string, group: NamedBlock): string {
    const numbered = group.ordinal === undefined ? base : `${base} ${group.ordinal}`;
    return group.detail === undefined ? numbered : `${numbered} (${group.detail})`;
}

/** What the block depicts, as words: the vocabulary's name per code, plus whatever the block qualifies. */
function words(group: IeGroup): string {
    if (group.codes === undefined) return "(unused)";
    return qualified(joined(group.codes.map((code) => SEQUENCES[code])), group);
}

/**
 * Whether the engine draws this sequence by running the block backwards.
 *
 * Only getting up, and only where it SHARES a block: with no clip of its own, the engine plays whatever put
 * the creature on the floor back to front - the death for the families that fold sleeping into it, the
 * lying-down band for the character one. A family that gives the get-up a block of its own addresses that
 * block directly and plays it forwards - the fine monster scheme does exactly this, so a rule keyed on the
 * code alone would play that whole family's get-up backwards.
 */
function reversedSequence(group: NamedBlock, code: SequenceCode): boolean {
    return code === "GU" && group.codes.length > 1;
}

/** One sequence of a block, as a stance list names it. */
export interface BlockSequence {
    /** Which of the block's codes this row is - what tells two rows of one band apart. */
    code: SequenceCode;
    /** What the stance list shows. */
    name: string;
    /** What it depicts, where the block or the code pins it. */
    id?: NeutralActionId;
    /** Set where the band is drawn back to front - see `reversedSequence`. */
    reversed?: true;
}

/**
 * A block as the rows of a stance list: one per sequence the engine plays the band for.
 *
 * Several, where a band is shared - a dragon holds one pose to stand, to square up and while conjuring, and
 * a reader picking a stance asks for one of those, not for the sentence naming all three. `blockLabel` keeps
 * the joined form, because a block picker over one file is showing what the FILE holds.
 */
export function blockSequences(group: IeGroup): BlockSequence[] {
    if (group.codes === undefined) return [];
    return group.codes.map((code) => {
        const id = sequenceId(group, code);
        return {
            code,
            name: capitalized(qualified(SEQUENCES[code], group)),
            ...(id === undefined ? {} : { id }),
            ...(reversedSequence(group, code) ? { reversed: true as const } : {}),
        };
    });
}

/**
 * What one sequence of a block depicts.
 *
 * A block naming ONE sequence keeps what the block itself declares, an absence included: the burrower's
 * hidden stand refuses the `stand` its emerged twin already carries, and deriving an id from the code would
 * put it back. A SHARED band declares nothing - there is no single answer to declare - so each row falls
 * back to what its own code means, which is the only per-row statement available.
 */
function sequenceId(group: NamedBlock, code: SequenceCode): NeutralActionId | undefined {
    if (group.codes.length === 1) return group.id;
    const { id } = decodeActionCode("action-codes", code);
    return id === "unpinned" ? undefined : id;
}

/** The block as a file's reader sees it: the codes that address it in the archive, then what it depicts. */
export function blockLabel(group: IeGroup): string {
    return group.codes === undefined ? "(unused)" : `${group.codes.join("/")} - ${words(group)}`;
}

// The FIRST block of each pair is the conjure loop played while casting, the SECOND the one-shot
// release (engine playback order; note IESDP's CA/SP block names invert it). Both schemes lay their
// cast files out this way - only the block size differs - so the two keys share one list.
//
// No `id`: the vocabulary's `spell` covers both halves precisely because the sources disagree about
// which is which, so a block that IS one of the two is exactly the case it refuses to name.
const CAST_BLOCKS: IeGroup[] = [
    { codes: ["SP"], ordinal: 1 },
    { codes: ["CA"], ordinal: 1 },
    { codes: ["SP"], ordinal: 2 },
    { codes: ["CA"], ordinal: 2 },
    { codes: ["SP"], ordinal: 3 },
    { codes: ["CA"], ordinal: 3 },
    { codes: ["SP"], ordinal: 4 },
    { codes: ["CA"], ordinal: 4 },
];

/**
 * The eight blocks the fine-scheme monster families pack into one `G1`, in order.
 *
 * Shorter files of the same family carry a PREFIX of this: the layout addresses a stance by its block
 * position, so a file holding six blocks holds the first six. Sliced rather than restated so the order is
 * stated once.
 */
const MONSTER_G1: IeGroup[] = [
    { codes: ["WK"], id: "walk" },
    { codes: ["SC"], id: "ready" },
    { codes: ["SD"], id: "stand" },
    { codes: ["GH"], id: "get-hit" },
    { codes: ["DE"], id: "die" },
    { codes: ["TW"], id: "twitch" },
    { codes: ["SL"], id: "sleep" },
    { codes: ["GU"], id: "get-up" },
];

/** The same family's `G2`, on the same prefix rule. */
const MONSTER_G2: IeGroup[] = [
    // Numbered, not named: this family ships five interchangeable strikes and the reference browser
    // numbers them too. A family that genuinely distinguishes its strikes carries `detail` instead.
    { codes: ["A1"], id: "attack" },
    { codes: ["A2"], id: "attack", ordinal: 2 },
    { codes: ["A3"], id: "attack", ordinal: 3 },
    { codes: ["A4"], id: "attack", ordinal: 4 },
    { codes: ["A5"], id: "attack", ordinal: 5 },
    { codes: ["SP"] },
    { codes: ["CA"] },
];

// The burrowing family's three files. Its `G1` opens on a block no sequence addresses - the first stance
// starts one block in - so that block is named for being unaddressed rather than numbered like a block
// whose name is merely unknown. EMERGE and HIDE carry no `id`: the neutral vocabulary has no member for
// going to ground, and inventing one would put a word in every converter's mouth.
const ANKHEG_G1: IeGroup[] = [
    { unused: true },
    { codes: ["DE"], id: "die" },
    { codes: ["TW"], id: "twitch" },
    { codes: ["SD"], id: "stand", detail: "emerged" },
];
const ANKHEG_G2: IeGroup[] = [
    // Unpinned: this is the burrower's second standing block, the one it holds underground. Both reference
    // implementations name it a stand rather than a combat stance, and it cannot take the `stand` id the
    // emerged block above already carries.
    { codes: ["SD"], detail: "hidden" },
    { codes: ["EMERGE"] },
    { codes: ["HIDE"] },
];
/**
 * The body and attack files the two wide-band split-part families share.
 *
 * Both lay `G1`/`G2`/`G3` out identically - walk, then the body stances, then the strikes - and differ
 * only in how wide a band is, which the table's key already carries. Stated once so they cannot drift.
 */
const WIDE_BODY: IeGroup[] = [
    { codes: ["SD"], id: "stand" },
    { codes: ["SC"], id: "ready" },
    { codes: ["GH"], id: "get-hit" },
    { codes: ["DE"], id: "die" },
    { codes: ["TW"], id: "twitch" },
];

const WIDE_ATTACKS: IeGroup[] = [
    { codes: ["A1"], id: "attack" },
    { codes: ["A2"], id: "attack", ordinal: 2 },
    { codes: ["A3"], ordinal: 3 },
];

const ANKHEG_G3: IeGroup[] = [
    { codes: ["A1"], id: "attack" },
    // Pinned, unlike the paired cast blocks above: those refuse an id because the sources disagree about
    // which half is which, and a lone cast block has no half to be confused with.
    { codes: ["CA"], id: "spell" },
];

/**
 * Known multi-sequence file layouts from the IE animation schemes (IESDP ini_anim.htm), keyed by the
 * filename's trailing sequence token, the block scheme, and the block count - optionally prefixed by the
 * animation's declared section, which is read first where the caller knows it. All of token, scheme and
 * count are needed: one token names several families, and a G1 of nine coarse blocks is a different
 * animation from a G1 of nine fine ones. Even those three collide across sections, which is what the
 * section-qualified keys settle: a three-block ie8 `G2` is `A1/A2/A3` in the layered families, `A1/A3/CA`
 * in the older monster one, and the burrowing trio in the ankheg one. A BAM stores no sequence names; the
 * filename convention is the only in-reach source, so an unmatched key falls back to numbered groups. The
 * optional trailing "e" covers eastern *E.BAM companions. Block sets the documentation does not pin down
 * are deliberately absent rather than guessed - a numbered group is honest, a wrong name is not.
 */
/**
 * One character attack file, in the one- and two-band shapes the install ships it in.
 *
 * Two entries rather than one, because the table keys on block COUNT: some of these files carry a second
 * band and some do not, and the entry for the two-band shape is the only place that can say the extra one
 * is addressed by nothing. Without it those files listed a phantom stance apiece.
 */
function attackFile(
    token: AttackToken,
    codes: readonly [SequenceCode, ...SequenceCode[]],
): Partial<Record<BlockKey, IeGroup[]>> {
    // Which strike a numbered attack depicts is the naming table's fact, and it is the same fact whether a
    // reader is looking at this family's blocks or at a character file's name - so it is read from there
    // rather than spelled a second time here, where the two wordings would drift apart unnoticed.
    const strikeBlock: IeGroup = { codes, id: "attack", detail: decodeActionCode("character", codes[0]).detail };
    const padding: IeGroup = { unused: true };
    return {
        [`character_old/${token}/ie8/1`]: [strikeBlock],
        [`character_old/${token}/ie8/2`]: [strikeBlock, padding],
    };
}

/**
 * How a block layout is addressed: the file's sequence token, the band width, and how many blocks it has,
 * optionally narrowed by the animation's declared section.
 *
 * Typed rather than left as `string` because a key that matches nothing FIRES nothing - a mistyped section
 * or token is not a lookup failure anyone sees, it is a family that quietly keeps numbering its stances.
 * That is exactly how this table came to be missing nine sections at once.
 */
type BlockKey =
    | `${SequenceToken}/${BandWidth}/${number}`
    | `${ModelledSection}/${SequenceToken}/${BandWidth}/${number}`;

const IE_SEQUENCE_NAMES: Partial<Record<BlockKey, IeGroup[]>> = {
    "ca/ie8/8": CAST_BLOCKS,
    "ca/ie9/8": CAST_BLOCKS,
    "g1/ie8/9": [
        { codes: ["WK"], id: "walk" },
        { codes: ["SC"], id: "ready", detail: "1-handed" },
        { codes: ["SD"], id: "stand", detail: "1-handed" },
        { codes: ["SC"], id: "ready", detail: "2-handed" },
        { codes: ["SD"], id: "stand", detail: "2-handed" },
        { codes: ["GH"], id: "get-hit" },
        // The older character family at its longer length: sleeping gets a band of its own here, where the
        // eight-block file below folds it into the death. Getting up does not follow it - the reference
        // browser addresses the get-up at the dying band for the whole family, and the sleep this length
        // splits out is a single frame per facing with nothing in it to run backwards.
        { codes: ["DE", "GU"] },
        { codes: ["TW"], id: "twitch" },
        { codes: ["SL"], id: "sleep" },
    ],
    "g1/ie8/6": [
        { codes: ["WK"], id: "walk" },
        { codes: ["SC"], id: "ready" },
        { codes: ["SD"], id: "stand" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
        { codes: ["TW"], id: "twitch" },
    ],
    // The second and third blocks are each played for an attack AND a spell - one clip serving both, the
    // same sharing the wide families do. Neither takes an `id`, since no one term covers a pair like that;
    // each ROW takes the meaning of its own code.
    "g2/ie8/3": [{ codes: ["A1"], id: "attack" }, { codes: ["A2", "CA"] }, { codes: ["A3", "SP"] }],
    // Fine-scheme monster (unsplit G1/G2) and character G1, plus the shorter files of the same family.
    "g1/ie9/8": MONSTER_G1,
    "g1/ie9/7": MONSTER_G1.slice(0, 7),
    "g1/ie9/6": MONSTER_G1.slice(0, 6),
    "g2/ie9/7": MONSTER_G2,
    "g2/ie9/6": MONSTER_G2.slice(0, 6),
    "g2/ie9/5": MONSTER_G2.slice(0, 5),
    "g1/ie9/11": [
        { codes: ["WK"], id: "walk" },
        { codes: ["SC"], id: "ready", detail: "1-handed" },
        { codes: ["SD"], id: "stand", detail: "1-handed" },
        { codes: ["SC"], id: "ready", detail: "2-handed" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
        { codes: ["TW"], id: "twitch" },
        // A repeat, not a grip: this family's later stands and sleeps are numbered variants of one stance,
        // where the nine-block table's `SD2` is the two-handed one. Same code, different qualifier.
        { codes: ["SD"], id: "stand", ordinal: 2 },
        { codes: ["SD"], id: "stand", ordinal: 3 },
        // Lying down, and standing back up by running the same band backwards - the reference browser
        // addresses the get-up at both of these offsets under its reversed marker. The other
        // reimplementation reads the first as a get-up played FORWARD and leaves sleeping no band at all;
        // taken as the shared pair, which is the only reading that gives both directions a clip.
        { codes: ["SL", "GU"], id: "sleep", ordinal: 1 },
        { codes: ["SL", "GU"], id: "sleep", ordinal: 2 },
    ],

    // Sections whose layout differs from the family the bare key names. Both burrowing schemes lay the
    // same blocks out - only the band width differs - so the two keys share one list.
    // The older character family's body file, whose eight blocks the reference browser addresses at
    // offsets 0/8/.../56. Its own G1 is shorter than the nine-block one above by folding sleep into the
    // dying block - which the engine also plays backwards to stand the creature up again.
    "character_old/g1/ie8/8": [
        { codes: ["WK"], id: "walk" },
        { codes: ["SC"], id: "ready", detail: "1-handed" },
        { codes: ["SD"], id: "stand", detail: "1-handed" },
        { codes: ["SC"], id: "ready", detail: "2-handed" },
        { codes: ["SD"], id: "stand", detail: "2-handed" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE", "SL", "GU"] },
        { codes: ["TW"], id: "twitch" },
    ],
    // The older character family's attack files. Each holds ONE addressed strike - the reference browser
    // maps every one of them to a single sequence at the file's first block - and the second band some of
    // them carry is padding the scheme never plays. Named per strike, since this family DOES distinguish
    // them: `A1` is a one-handed slash here where a monster's `A1` is just its first attack.
    ...attackFile("a1", ["A1"]),
    ...attackFile("a2", ["A2"]),
    ...attackFile("a3", ["A3"]),
    ...attackFile("a4", ["A4"]),
    ...attackFile("a5", ["A5"]),
    // The spell layer's own G1 stops one block short of the base it is drawn over, so it needs the prefix
    // said explicitly like every other shortened file of a family.
    "monster_layered_spell/g1/ie8/5": [
        { codes: ["WK"], id: "walk" },
        { codes: ["SC"], id: "ready" },
        { codes: ["SD"], id: "stand" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
    ],
    "monster_ankheg/g1/ie8/4": ANKHEG_G1,
    "monster_ankheg/g2/ie8/3": ANKHEG_G2,
    "monster_ankheg/g3/ie8/2": ANKHEG_G3,
    "monster_ankheg/g1/ie9/4": ANKHEG_G1,
    "monster_ankheg/g2/ie9/3": ANKHEG_G2,
    "monster_ankheg/g3/ie9/2": ANKHEG_G3,
    // The older monster family's attacks: A1, then A3, then a cast - not the layered families' pair of
    // ambiguous blocks, which is what the bare `g2/ie8/3` key names. A file two blocks long holds the first
    // two, the layout addressing a stance by position. `A3` stays unpinned wherever it appears: the code
    // list gives it two meanings, and the action table takes the same posture on it.
    "monster_old/g2/ie8/3": [{ codes: ["A1"], id: "attack" }, { codes: ["A3"] }, { codes: ["CA"], id: "spell" }],
    "monster_old/g2/ie8/2": [{ codes: ["A1"], id: "attack" }, { codes: ["A3"] }],
    "monster_large/g1/ie8/3": [
        { codes: ["SD"], id: "stand" },
        { codes: ["SC"], id: "ready" },
        { codes: ["WK"], id: "walk" },
    ],
    "monster_large/g2/ie8/2": [
        { codes: ["A1"], id: "attack" },
        { codes: ["A2"], id: "attack", ordinal: 2 },
    ],
    "monster_large/g3/ie8/4": [
        { codes: ["A3"] },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
        { codes: ["TW"], id: "twitch" },
    ],
    "ambient_static/g1/ie8/5": [
        { codes: ["SC"], id: "ready" },
        { codes: ["SD"], id: "stand" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
        { codes: ["TW"], id: "twitch" },
    ],

    // The split-part families, whose files carry no sequence token at all - their stance group is a digit
    // in the middle of the name, so the member's own label is what addresses these (see `ieGroups`).
    //
    // The two wide-band families lay their three files out identically; only the band width differs, which
    // the key already carries. Every one of these was missing, and a whole install's worth of tiled
    // creatures - dragons, wyverns, the demons - listed their stances as "G2 - group 1".
    "monster_quadrant/g1/ie16/1": [{ codes: ["WK"], id: "walk" }],
    "monster_quadrant/g2/ie16/5": WIDE_BODY,
    "monster_quadrant/g3/ie16/3": WIDE_ATTACKS,
    "monster_large16/g1/ie16/1": [{ codes: ["WK"], id: "walk" }],
    "monster_large16/g2/ie16/5": WIDE_BODY,
    "monster_large16/g3/ie16/3": WIDE_ATTACKS,

    // The huge split-part creatures. The install declares these `multi_new`, which the naming
    // documentation itself flags as mis-assigned over this slot range - the engine hardcodes the layout
    // below instead, and it is the one the shipped files match: measured band counts 1/3/3/5/2 against a
    // red dragon, exactly the five groups this names.
    "multi_new/g1/ie9/1": [{ codes: ["WK"], id: "walk" }],
    "multi_new/g2/ie9/3": [
        // One band serving three sequences: the creature holds this pose to stand, to square up, and
        // while conjuring. The two behind it are addressed by nothing.
        { codes: ["SD", "SC", "SP"] },
        { unused: true },
        { unused: true },
    ],
    "multi_new/g3/ie9/3": [{ codes: ["A1"], id: "attack" }, { unused: true }, { unused: true }],
    "multi_new/g4/ie9/5": [
        { codes: ["GH"], id: "get-hit" },
        // The engine plays this one backwards to get the creature up again.
        { codes: ["DE", "SL", "GU"] },
        { codes: ["TW"], id: "twitch" },
        { unused: true },
        { unused: true },
    ],
    "multi_new/g5/ie9/2": [{ unused: true }, { codes: ["CA"], id: "spell" }],

    // Static scenery creatures: one file, five wide bands.
    "town_static/-/ie16/5": [
        { codes: ["SC"], id: "ready" },
        { codes: ["SD"], id: "stand" },
        { codes: ["GH"], id: "get-hit" },
        { codes: ["DE"], id: "die" },
        { codes: ["TW"], id: "twitch" },
    ],

    // Birds. The documentation names these by what they look like as well as by code, and the codes are
    // what the engine plays: the still pose stands, the flapping one walks.
    "flying/-/ie9/2": [
        { codes: ["SD"], id: "stand", detail: "still" },
        { codes: ["WK"], id: "walk", detail: "flapping" },
    ],
};

/**
 * The sequence tokens a filename can end on, each with the pattern that finds it.
 *
 * Digits AFTER the token belong to it: a family that spreads its bands over several files numbers them
 * from the packed name, so `...G15` is the fifth file of the `G1` family and carries that family's whole
 * block skeleton, drawing only the bands its own digit names. Those files take the family's block names
 * rather than numbers of their own - which is the same reading the character scheme already takes of its
 * misc files.
 */
const IE_SEQUENCE_TOKENS: readonly (readonly [SequenceToken, RegExp])[] = (
    ["g1", "g2", "g3", "g4", "g5", "ca", "a1", "a2", "a3", "a4", "a5", "a6"] as const
).map((token) => [token, new RegExp(`${token}\\d*$`)]);

/**
 * One documented block layout, addressed by what identifies it rather than by a filename.
 *
 * Exported for the writer's side of the same fact: a character misc file draws one band of a layout, so
 * what that file depicts is what that block depicts, and reading it from here keeps one statement of it.
 */
export function ieBlocks(
    token: SequenceToken,
    scheme: BandWidth,
    count: number,
    section?: string,
): IeGroup[] | undefined {
    // Exact count, deliberately. A shorter file of a family does hold a PREFIX of its layout, but that is
    // stated per family by the entries below - searching upward for any longer table with the same token
    // and scheme instead lends one family's names to another, which is what a nine-block `ie9` file
    // borrowing the eleven-block character layout looked like.
    const structural = `${token}/${scheme}/${count}` as const;
    // The SECTION is whatever the install declared, so it is a plain string here and the narrowed key type
    // cannot describe it. The cast is on the lookup only: writing the table is still checked.
    const bySection = section === undefined ? undefined : (`${section}/${structural}` as BlockKey);
    return (bySection === undefined ? undefined : IE_SEQUENCE_NAMES[bySection]) ?? IE_SEQUENCE_NAMES[structural];
}

/**
 * The key segment for a band no block SCHEME covers.
 *
 * The three wide-band families store sixteen cycles to a band, which matches neither eight-slot scheme, so
 * `schemeForStride` answers undefined for them - and a key built from that named nothing, which is why
 * every static scenery creature and every big wyvern listed numbered stances. The width stands in for the
 * scheme here because that is all the scheme ever contributed to the key.
 */
export type WideBand = "ie16";

/** Every band width a key can name - the block schemes, plus the one no scheme covers. */
type BandWidth = IeScheme | WideBand;

/**
 * The tokens a file's name can end on, plus the stand-in for a section whose animation is one untokenised
 * file. Closed, so a key cannot name a token the lookup below never generates.
 */
type SequenceToken = "g1" | "g2" | "g3" | "g4" | "g5" | "ca" | AttackToken | typeof SINGLE_FILE;

/**
 * The character families name an attack file after the strike it holds rather than after a block group.
 *
 * Needed as tokens because such a file can carry a SECOND band the scheme addresses nothing to, and the
 * only way to say so is a table entry - which needs a key, which needs a token.
 */
type AttackToken = "a1" | "a2" | "a3" | "a4" | "a5" | "a6";

/**
 * The documented blocks of a multi-block file, from its sequence token and the block scheme, narrowed by
 * the animation's declared section where the caller knows it; undefined when the combination matches no
 * documented layout (callers number the groups instead).
 *
 * `names` is every string that might carry the token, most specific first. Usually just the filename - but
 * the split-part families put their stance group in the MIDDLE of the name (`MDR1` + group + tile + cycle),
 * so those files carry no trailing token at all and the member's own label (`G4`) is the only thing that
 * addresses them. Passing both costs one failed match and is what stopped a whole install's tiled
 * creatures falling through to numbered groups.
 */
export function ieGroups(
    names: string | readonly string[],
    groupCount: number,
    scheme?: IeScheme | WideBand,
    section?: string,
): IeGroup[] | undefined {
    if (scheme === undefined) return undefined;
    for (const name of typeof names === "string" ? [names] : names) {
        const found = blocksNamed(name, groupCount, scheme, section);
        if (found !== undefined) return found;
    }
    return undefined;
}

function blocksNamed(
    basename: string,
    groupCount: number,
    scheme: IeScheme | WideBand,
    section?: string,
): IeGroup[] | undefined {
    const stem = basename.toLowerCase().replace(/\.[^.]*$/, "");
    for (const candidate of [stem, stem.replace(/e$/, "")]) {
        for (const [token, pattern] of IE_SEQUENCE_TOKENS) {
            // Keep looking when the token names no layout, rather than returning its miss: one static
            // scenery creature is called `MSPLG1`, and letting that accidental token settle the answer hid
            // the section's own single-file table from it.
            const found = pattern.test(candidate) ? ieBlocks(token, scheme, groupCount, section) : undefined;
            if (found !== undefined) return found;
        }
    }
    // A section whose whole animation is ONE file names no sequence in the filename - there is nothing to
    // distinguish, so the blocks are keyed by the section alone. Tried only after every token has failed,
    // so a family that does carry tokens can never fall into another's table.
    return section === undefined ? undefined : ieBlocks(SINGLE_FILE, scheme, groupCount, section);
}

/** The token stand-in for a section whose animation is a single untokenised file. */
const SINGLE_FILE = "-" as const;
