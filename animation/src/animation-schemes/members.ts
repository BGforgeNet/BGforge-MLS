/**
 * The files one animation draws, for every layout but `character`.
 *
 * Decided against the archive rather than against a table, exactly as the character scheme decides its
 * actions: which cycles an animation ships varies per animation, and offering one the install lacks would
 * resolve to a name nothing can open.
 *
 * An action-code member carries the stance its suffix names, since the mapping from suffix to stance is a
 * documented property of the naming scheme rather than a guess. The suffix stays in the label beside it:
 * it is what the filename shows, and it is what a reader comparing this against an archive listing needs.
 * Codes the sources do not agree on keep the bare suffix - see `ACTION_CODES`.
 *
 * The cycle and quadrant layouts keep their bare `G1`/`G11` suffixes here, because such a file packs
 * SEVERAL stances as consecutive direction bands; naming those is the band layer's job, not the file's.
 */

import { type NeutralActionRef, decodeActionCode } from "./actions";
import { type Layout } from "./layout";

export interface SchemeMember {
    /** What a picker shows: the suffix, or the resref itself where the layout has no suffix. */
    label: string;
    /**
     * What this member depicts, decoded from the code its name carries.
     *
     * Decided here rather than by a reader of the label, because this is the only layer that knows which
     * naming family produced the code - and `A4` means a ranged attack in one family and a two-handed
     * backslash in another.
     */
    action: NeutralActionRef;
    /** The file that identifies this member - the first one it draws. */
    resref: string;
    /**
     * Every file this member draws from, the one it is named for first.
     *
     * More than one where the picture is split (a quadrant animation ships four files holding one quarter
     * each) or where the facings are (an unmirrored scheme keeps its eastern ones in an `E` twin). Neither
     * is a set of alternatives: they are ONE member here and the caller composes them.
     */
    parts: readonly string[];
    /**
     * Which second set of files this member came from, where it came from one - absent for a base member.
     *
     * Carried beside the label rather than read back out of it: a consumer that names bands from a block
     * table discards the member's label, and the two runs are then indistinguishable (`bands.ts`).
     */
    layer?: string;
}

/** A member before the archive has been asked which of its files exist. */
interface MemberShape {
    label: string;
    action: NeutralActionRef;
    parts: readonly string[];
}

/** Cycles a one-file-per-cycle animation can carry. */
const CYCLES = ["G1", "G2", "G3"] as const;

/**
 * Two-character codes an action-code animation can carry, and the stance each names.
 *
 * Every one of these appears in a shipped install; the per-animation filter below decides which of them a
 * given animation actually has, since only nine are common to all of them.
 *
 * A code maps to a name only where the sources agree on it. `A3` is unpinned, and `CA`/`SP` are the pair
 * the engine's playback order and the published block names invert relative to each other - so both stay
 * bare rather than shipping one reading of a disagreement as a fact. The gloss wording matches the block
 * labels in `image-editor/webview/render/cycle-grouping.ts`, which is the other surface naming these.
 *
 * Deliberately separate from `actions.ts`, which is the authority on what a code MEANS: these words have to
 * match what the cycle view calls the same block, and that table has to match the published naming. Where
 * they differ the difference is the point, not drift.
 */
const ACTION_CODES: Readonly<Record<string, string | undefined>> = {
    A1: "attack",
    A2: "jab",
    A3: undefined,
    A4: "shoot",
    CA: undefined,
    DE: "die",
    GH: "get hit",
    GU: "get up",
    SC: "combat stance",
    SD: "stand",
    SL: "sleep",
    SP: undefined,
    TW: "twitch",
    WK: "walk",
};

/** `WK - walk` where the code is pinned, the bare code where it is not. */
function actionLabel(code: string): string {
    const name = ACTION_CODES[code];
    return name === undefined ? code : `${code} - ${name}`;
}

const QUADRANTS = [1, 2, 3, 4] as const;

/** Stance groups a tiled animation can carry, and the 3x3 grid each one's picture is cut into. */
const PIECE_STANCES = [1, 2, 3, 4, 5] as const;
const TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/**
 * The cycle each tile file draws, as its name's last two digits.
 *
 * Read as a cycle number rather than a facing: a stance storing more than nine cycles numbers the later
 * ones 10-18 and 20-28, so the tens digit is part of the number and not a second dimension. Offering all
 * three ranges costs only lookups - the archive decides which a given animation ships.
 */
const TILE_CYCLES = [0, 1, 2].flatMap((tens) => TILES.map((_, at) => `${tens}${at}`));

/** A member of the cycle-numbered family: the digits are its name, and nothing pins what they depict. */
function cycleMember(label: string, parts: readonly string[]): MemberShape {
    return { label, action: decodeActionCode("cycle-numbers", label), parts };
}

/**
 * A file and the eastern twin holding the facings it does not, base first.
 *
 * Every unmirrored scheme stores the western facings in the main file and the three eastern ones in an `E`
 * twin at the same cycle positions, so a member that lists only the main file draws whatever the base pads
 * those slots with - and in some sections the base's table stops before reaching them at all. Listing the
 * twin costs nothing where the install ships none: `schemeMembers` drops parts that do not exist.
 */
function withEast(resref: string): string[] {
    return [resref, `${resref}E`];
}

function candidates(layout: Layout, resref: string): MemberShape[] {
    switch (layout) {
        case "bare":
            // The file IS the animation, so it carries no action code at all - the empty one, which names
            // the file back as the bare resref when a set is written.
            return [{ label: resref, action: decodeActionCode("cycle-numbers", ""), parts: [resref] }];
        case "cycles":
            return CYCLES.map((cycle) => cycleMember(cycle, withEast(`${resref}${cycle}`)));
        case "quadrant":
            // One member per cycle, drawing that cycle's four quarters together - and each quarter's own
            // eastern twin after them, since the split is of the picture, not of the facings.
            return CYCLES.map((cycle) =>
                cycleMember(cycle, [
                    ...QUADRANTS.map((quadrant) => `${resref}${cycle}${quadrant}`),
                    ...QUADRANTS.map((quadrant) => `${resref}${cycle}${quadrant}E`),
                ]),
            );
        case "pieces":
            // One member per stance group, drawing every tile of every facing that stance stores. They are
            // pieces of one picture across the grid AND across the cycle table, so the caller composes the
            // lot: a tile file's untouched cycles are placeholders that compose away.
            return PIECE_STANCES.map((stance) =>
                cycleMember(
                    `G${stance}`,
                    TILE_CYCLES.flatMap((cycle) => TILES.map((tile) => `${resref}${stance}${tile}${cycle}`)),
                ),
            );
        case "actions":
            return Object.keys(ACTION_CODES).map((code) => ({
                label: actionLabel(code),
                action: decodeActionCode("action-codes", code),
                parts: withEast(`${resref}${code}`),
            }));
        case "mixed":
            // TODO: the id range above the tiled dragons numbers a THIRD digit after the quadrant -
            // `<resref>G<group><quadrant><variant>` - and none of the candidates below generates it. Measured
            // on a Baldur's Gate II Enhanced Edition install: `MDEM` (the only animation in the family that
            // uses it) ships 52 files, of which the quadrant candidate reaches the 8 whose stance carries no
            // variant digit. The other 44 are a naming family of their own, not a variant of these.
            return [
                ...candidates("quadrant", resref),
                ...candidates("pieces", resref),
                ...candidates("cycles", resref),
                ...candidates("actions", resref),
            ];
        case "characterOld":
            // The base files are the character scheme's own; only the mirrored twin below is extra, and it
            // is a part of its member rather than a member of its own.
            return [];
        case "character":
            // Armour level is a dimension of its own, so that layout resolves through `character.ts`.
            return [];
    }
}

/**
 * The members this animation actually ships, in the order a picker should offer them.
 *
 * A member survives when at least one of its files does, carrying only the ones present: a quadrant
 * animation missing a quarter still draws the rest, which is better than offering nothing.
 */
export function schemeMembers(
    layout: Layout,
    resref: string | undefined,
    exists: (resref: string) => boolean,
    layer?: string,
): SchemeMember[] {
    if (resref === undefined) return [];
    return candidates(layout, resref).flatMap((member) => {
        const parts = member.parts.filter(exists);
        const first = parts[0];
        if (first === undefined) return [];
        // The layer does not change what the member DEPICTS - that is still what its cycle code says - so
        // it rides in the label, and beside it as a field for the consumers that build their own.
        const label = layer === undefined ? member.label : `${member.label} (${layer})`;
        return [{ label, action: member.action, resref: first, parts, ...(layer === undefined ? {} : { layer }) }];
    });
}
