/**
 * Versioned on-disk manifest for an exported animation SET directory.
 *
 * The per-animation manifest in `@bgforge/image` describes one file's frames and sequences; this one sits a
 * level above it and describes which files a set is made of. An exported set folder therefore holds this
 * plus one ordinary animation directory per member, so both readers stay unchanged and neither has to know
 * about the other's level.
 *
 * A FROZEN wire format, like its sibling: a new field on `AnimationSet` is a conscious mapping decision
 * here, not a silent addition to what a directory records.
 */

/** One exported member: the file it came from, and the folder its frames were written into. */
export interface SetManifestMember {
    resref: string;
    armour: number;
    /**
     * The folder holding this member's own animation directory, relative to the set folder.
     *
     * Carried rather than derived from the resref: an importer opens the folder this names, so a reader who
     * renames one fixes the manifest instead of the tool guessing at the mapping.
     */
    directory: string;
}

/** Where an exported set came from. Read by people, never keyed off on import. */
export interface SetManifestSource {
    id: number;
    title: string;
    /** The install the source was read from, absent where nothing named one. */
    flavour?: string;
}

export interface SetManifestV1 {
    manifestVersion: 1;
    kind: "bgforge-animation-set";
    source: SetManifestSource;
    members: SetManifestMember[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

function isMember(v: unknown): v is SetManifestMember {
    return (
        isRecord(v) && typeof v.resref === "string" && typeof v.armour === "number" && typeof v.directory === "string"
    );
}

function isSource(v: unknown): v is SetManifestSource {
    return (
        isRecord(v) &&
        typeof v.id === "number" &&
        typeof v.title === "string" &&
        (v.flavour === undefined || typeof v.flavour === "string")
    );
}

export function writeSetManifest(input: { source: SetManifestSource; members: SetManifestMember[] }): SetManifestV1 {
    return {
        manifestVersion: 1,
        kind: "bgforge-animation-set",
        // Rebuilt field by field rather than spread: the wire format is frozen, so a field added to the
        // caller's own shape must be mapped here deliberately instead of leaking into the file.
        source: {
            id: input.source.id,
            title: input.source.title,
            ...(input.source.flavour === undefined ? {} : { flavour: input.source.flavour }),
        },
        members: input.members.map((member) => ({
            resref: member.resref,
            armour: member.armour,
            directory: member.directory,
        })),
    };
}

export function readSetManifest(value: unknown): SetManifestV1 {
    if (!isRecord(value)) throw new Error("readSetManifest: not an exported animation set (manifest is not an object)");
    if (value.kind !== "bgforge-animation-set") {
        throw new Error(`readSetManifest: not an exported animation set (kind "${String(value.kind)}")`);
    }
    if (value.manifestVersion !== 1) {
        throw new Error(`readSetManifest: unsupported manifest version ${String(value.manifestVersion)}`);
    }
    if (!isSource(value.source)) throw new Error("readSetManifest: the source names no id and title");
    if (!Array.isArray(value.members) || !value.members.every(isMember)) {
        throw new Error("readSetManifest: every member needs a resref, an armour level and a directory");
    }
    return writeSetManifest({ source: value.source, members: value.members });
}
