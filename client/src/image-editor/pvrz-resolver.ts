import { type PvrzResolver, pvrzResourceName } from "@bgforge/image";

/**
 * Where a BAM v2's PVRZ pages are looked up, in priority order. Both sources take the resource NAME
 * rather than the page number, so the page-to-resource mapping stays in one place (the library's
 * `pvrzResourceName`) instead of being re-derived per source.
 */
export interface PvrzSources {
    /** A file sitting next to the opened `.bam`. This is how a mod folder ships its own pages. */
    readSibling: (resource: string) => Uint8Array | undefined;
    /** The installed game, through its override folders and BIFs. Absent when no game is open. */
    readGameResource?: (resource: string) => Uint8Array | undefined;
}

/**
 * Sibling directory first, then the game install.
 *
 * That order is deliberate: a mod folder's own PVRZ is the file the author is editing, and an
 * installed copy of the same page would otherwise shadow it. Returns undefined rather than a blank
 * page when neither has it - decodeBamV2 turns that into an error naming the resource, which is the
 * only thing distinguishing a missing texture from a legitimately transparent frame.
 */
export function composePvrzResolver(sources: PvrzSources): PvrzResolver {
    return (page) => {
        const resource = pvrzResourceName(page);
        return sources.readSibling(resource) ?? sources.readGameResource?.(resource);
    };
}
