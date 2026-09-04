/**
 * What a vendored animation table carries, and why one exists at all.
 *
 * An Enhanced Edition install declares every animation in a per-animation INI named after its id. A classic
 * install declares nothing: the mapping from id to BAM prefix lives in the engine, so the panel can list a
 * classic install's animations but not draw one. These tables are that mapping, written down.
 *
 * The rows are OURS, not a copy of anyone's file. Where an Enhanced Edition of the same game exists, they are
 * derived from its own declarations and then checked prefix by prefix against the classic archive - a table
 * that names a file the install does not ship is the defect this check exists to catch. Rows that survive
 * only in an engine are marked, per game, as unverified.
 *
 * A shipped declaration always wins: this is the fallback for an install that has none, never an override of
 * one that does. `~/.claude/rules/coding.md` calls vendoring a value space the environment owns a defect; the
 * point here is that a classic install does not own it.
 */

/**
 * One animation's drawing facts.
 *
 * `prefixes` is per armour level, index 0 being level 1 - not one prefix, because a set draws `CHMB1` through
 * `CHMB3` and then `CHMC4`. A single entry means every level shares it.
 */
export interface TableAnimation {
    readonly prefixes: readonly string[];
    /** The engine's own section name for the layout, as an EE install spells it, e.g. `character`. */
    readonly section: string;
    /** `resref_paperdoll` where it differs from the body; an aliasing set keeps its own inventory image. */
    readonly paperdoll?: string;
}

export type AnimationTable = ReadonlyMap<number, TableAnimation>;

/** A table's rows as written down: id first, so a reader scans the column that identifies the row. */
export type TableRows = readonly (readonly [id: number, animation: TableAnimation])[];

export function animationTable(rows: TableRows): AnimationTable {
    return new Map(rows);
}
