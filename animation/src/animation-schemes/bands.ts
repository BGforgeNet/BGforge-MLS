/**
 * An animation set's stances: what a viewer lists, and which cycles each one draws.
 *
 * A stance is a direction BAND - one action stored as consecutive cycles, one per facing. Where that
 * band lives varies by layout: an action-code animation gives each stance its own file, while a `G` file
 * packs several as consecutive bands. Both arrive here as (file, band index), so a viewer offers one
 * uniform list and never makes the reader think in files.
 *
 * Naming is deliberately split. A file whose suffix names its stance is labelled by `members.ts`; the
 * bands inside a multi-stance file are labelled by the block table the image editor already uses, so the
 * two surfaces name the same block identically. Where neither pins a name, the band is numbered - the
 * same posture that table takes, and for the same reason.
 */
import { ieGroupLabels } from "../group-labels";
import { type IeDirectionSlot, type IeScheme } from "@bgforge/image/ie-direction";
import { type SchemeMember } from "./members";

/**
 * Sections whose files band at sixteen cycles rather than eight or nine.
 *
 * Structural inference cannot tell these apart on its own - a sixteen-cycle band divides evenly into two
 * eight-slot blocks, so such a file reads as twice as many stances at half the facings. Measured across
 * an install's own declarations, only these two sections carry the wide band; every other section that
 * resolves is the eight-stride shape inference already reads correctly, so nothing else is overridden.
 */
const WIDE_BAND_SECTIONS = new Set(["monster_quadrant", "monster_large16"]);

const WIDE_BAND_STRIDE = 16;

/** The stride a section settles, or undefined to leave the reading to structural inference. */
export function declaredStride(section: string | undefined): number | undefined {
    return section !== undefined && WIDE_BAND_SECTIONS.has(section) ? WIDE_BAND_STRIDE : undefined;
}

/** One file's cycles, already cut into direction bands. */
export interface FileBands {
    bands: readonly (readonly IeDirectionSlot[])[];
    /** The block scheme, where one was resolved - what the block table keys its names on. */
    scheme: IeScheme | undefined;
}

/** One row of the viewer's stance list. */
export interface SetStance {
    /** What the sidebar shows. */
    label: string;
    /** The file this band's cycles live in - what "open this" means, and what the bands were read from. */
    resref: string;
    /**
     * Every file the stance draws, `resref` first.
     *
     * One file for almost everything; four for a quadrant animation, whose quarters compose into a single
     * picture. The parts share a cycle structure, so one band index addresses the same moment in each.
     */
    parts: readonly string[];
    /** Which band of that file, counting from zero. */
    band: number;
    /**
     * The band's cycles: which stored sequence draws each facing.
     *
     * Carried rather than counted because the rose needs the sequence indices to lay tiles out, and a
     * separate count would be a second statement of the same fact.
     */
    slots: readonly IeDirectionSlot[];
}

/**
 * Every stance a set's members offer, in member order.
 *
 * `bandsFor` bands one MEMBER - every file it draws, not only the first. Which facings a band stores is
 * read off content, so a member whose art is split across files has to be banded as the whole picture:
 * banding the first file alone reports the facings that file happens to hold. A member it cannot answer
 * for is dropped rather than listed, since a row that resolves to nothing is worse than no row. Bands
 * with no drawable facing go the same way.
 */
export function stancesOfMembers(
    members: readonly SchemeMember[],
    bandsFor: (member: SchemeMember) => FileBands | undefined,
): SetStance[] {
    const stances: SetStance[] = [];
    for (const member of members) {
        const file = bandsFor(member);
        if (file === undefined) continue;
        const labels = ieGroupLabels(member.resref, file.bands.length, file.scheme);
        for (const [band, slots] of file.bands.entries()) {
            if (slots.length === 0) continue;
            stances.push({
                label: bandLabel(member.label, labels, band, file.bands.length),
                resref: member.resref,
                parts: member.parts,
                band,
                slots,
            });
        }
    }
    return stances;
}

/** A single-band file is its own stance; a packed one takes the block's name, else a number. */
function bandLabel(member: string, labels: string[] | undefined, band: number, bandCount: number): string {
    if (bandCount === 1) return member;
    return labels?.[band] ?? `${member} - group ${band + 1}`;
}
