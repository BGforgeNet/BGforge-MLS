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

import { type Layout } from "./layout";

export interface SchemeMember {
    /** What a picker shows: the suffix, or the resref itself where the layout has no suffix. */
    label: string;
    /** The file that identifies this member - the first one it draws. */
    resref: string;
    /**
     * Every file this member draws from.
     *
     * More than one only for a quadrant animation, whose sprite is too large for a single BAM and ships
     * as four files holding one quarter each. Those are pieces of one picture rather than alternatives,
     * so they are ONE member here and the caller composes them.
     */
    parts: readonly string[];
}

/** A member before the archive has been asked which of its files exist. */
interface MemberShape {
    label: string;
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

function candidates(layout: Layout, resref: string): MemberShape[] {
    switch (layout) {
        case "bare":
            return [{ label: resref, parts: [resref] }];
        case "cycles":
            return CYCLES.map((cycle) => ({ label: cycle, parts: [`${resref}${cycle}`] }));
        case "quadrant":
            // One member per cycle, drawing that cycle's four quarters together.
            return CYCLES.map((cycle) => ({
                label: cycle,
                parts: QUADRANTS.map((quadrant) => `${resref}${cycle}${quadrant}`),
            }));
        case "actions":
            return Object.keys(ACTION_CODES).map((code) => ({
                label: actionLabel(code),
                parts: [`${resref}${code}`],
            }));
        case "mixed":
            return [
                ...candidates("quadrant", resref),
                ...candidates("cycles", resref),
                ...candidates("actions", resref),
            ];
        case "character":
        case "characterOld":
            // Armour level is a dimension of its own, so those layouts resolve through `character.ts`.
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
): SchemeMember[] {
    if (resref === undefined) return [];
    return candidates(layout, resref).flatMap((member) => {
        const parts = member.parts.filter(exists);
        const first = parts[0];
        return first === undefined ? [] : [{ label: member.label, resref: first, parts }];
    });
}
