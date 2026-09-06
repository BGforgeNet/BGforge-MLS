/**
 * One stance of an animation set, as an editor document model.
 *
 * Lives beside the editor rather than in the gallery because both surfaces ask for it: the gallery's
 * rose draws a stance, and a set document opens one as the model it edits. Building it twice would give
 * the two views separate decode and compose paths for the same picture.
 */
import { type Game } from "@bgforge/binary";
import { type StanceIo } from "@bgforge/animation";
import { composeParts } from "@bgforge/image";
import { ImageDocumentModel } from "./document-model";

/** Reads a set's members out of an open game, treating an unreadable member as a missing one. */
export function stanceIo(game: Game): StanceIo {
    const read = (resref: string): Uint8Array | undefined => {
        if (!game.canRead(resref, "bam")) return undefined;
        try {
            return game.read(resref, "bam");
        } catch {
            // One unreadable member is a missing row, not a dead page - the posture the index takes too.
            return undefined;
        }
    };
    return { exists: (resref) => game.canRead(resref, "bam"), read };
}

/**
 * One member of a set: the file it names, or the four quarters of an oversized creature composed into one
 * animation.
 *
 * Takes the two fields a member and a stance have in common rather than either type, because both callers
 * pass one: the gallery draws a stance, the editor opens a whole member.
 *
 * A quadrant animation's parts are pieces of a single sprite rather than alternatives, so drawing one of
 * them shows a corner. Composing needs every part to parse; a part that will not is dropped and the rest
 * still compose, which loses a quarter rather than the whole creature.
 */
export function stanceModel(
    io: StanceIo,
    stance: { resref: string; parts: readonly string[] },
): ImageDocumentModel | undefined {
    const parts = stance.parts.flatMap((resref) => {
        const bytes = io.read(resref);
        if (bytes === undefined) return [];
        try {
            return [ImageDocumentModel.fromBytes(bytes, `${resref}.BAM`)];
        } catch {
            // A part that will not parse is dropped so the rest still compose, as the header above states:
            // three quarters of a creature beats none of it.
            return [];
        }
    });
    const [first] = parts;
    if (first === undefined) return undefined;
    if (parts.length === 1) return first;

    const indexed = parts.flatMap((part) => {
        const animation = part.indexedAnimation();
        return animation === undefined ? [] : [animation];
    });
    const composed = indexed.length === parts.length ? composeParts(indexed) : undefined;
    // Composition refuses parts whose cycles disagree. Falling back to the first part draws a corner,
    // which is wrong but visible - and better than a stance that silently draws nothing.
    return composed === undefined ? first : ImageDocumentModel.fromAnimation(composed, `${stance.resref}.BAM`);
}
