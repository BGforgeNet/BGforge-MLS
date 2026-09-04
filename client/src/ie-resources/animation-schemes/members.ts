/**
 * The files one animation draws, for every layout but `character`.
 *
 * Decided against the archive rather than against a table, exactly as the character scheme decides its
 * actions: which cycles an animation ships varies per animation, and offering one the install lacks would
 * resolve to a name nothing can open.
 *
 * Members are named by their file suffix rather than by what the sequence depicts. The install declares no
 * such names and the codes are not self-evident, so labelling `SL` "sleep" would be a guess presented as a
 * fact - the suffix is what can be checked, and it is what the filename shows anyway.
 */

import { type Layout } from "./layout";

export interface SchemeMember {
    /** What a picker shows: the suffix, or the resref itself where the layout has no suffix. */
    label: string;
    resref: string;
}

/** Cycles a one-file-per-cycle animation can carry. */
const CYCLES = ["G1", "G2", "G3"] as const;

/**
 * Two-character codes an action-code animation can carry.
 *
 * Every one of these appears in a shipped install; the per-animation filter below decides which of them a
 * given animation actually has, since only nine are common to all of them.
 */
const ACTION_CODES = ["A1", "A2", "A3", "A4", "CA", "DE", "GH", "GU", "SC", "SD", "SL", "SP", "TW", "WK"];

const QUADRANTS = [1, 2, 3, 4] as const;

function candidates(layout: Layout, resref: string): SchemeMember[] {
    switch (layout) {
        case "bare":
            return [{ label: resref, resref }];
        case "cycles":
            return CYCLES.map((cycle) => ({ label: cycle, resref: `${resref}${cycle}` }));
        case "quadrant":
            return CYCLES.flatMap((cycle) =>
                QUADRANTS.map((quadrant) => ({
                    label: `${cycle}${quadrant}`,
                    resref: `${resref}${cycle}${quadrant}`,
                })),
            );
        case "actions":
            return ACTION_CODES.map((code) => ({ label: code, resref: `${resref}${code}` }));
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

/** The members this animation actually ships, in the order a picker should offer them. */
export function schemeMembers(
    layout: Layout,
    resref: string | undefined,
    exists: (resref: string) => boolean,
): SchemeMember[] {
    if (resref === undefined) return [];
    return candidates(layout, resref).filter((member) => exists(member.resref));
}
