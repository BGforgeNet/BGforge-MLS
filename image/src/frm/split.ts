import { type IndexedAnimation, type Frame, FRM_FACINGS } from "../model/animation.ts";

/**
 * Split a 6-direction FRM animation into the six single-direction animations a `<base>.fr0` ..
 * `<base>.fr5` set is made of - the inverse of `combineFrmDirections`, and what saving such a set
 * back in place writes.
 *
 * Each result is itself a complete FRM carrying only one facing's frames: all six of its sequences
 * alias that one frame pool, so the serializer collapses them onto a single data region and every
 * header data-offset slot ends up pointing at it. Facing d's own pixel offset is repeated across all
 * six x/y slots, which is where the combiner reads it back from when the set is next opened.
 *
 * A facing the animation draws nothing for yields a frameless file rather than being dropped, so the
 * result is always indexable by facing; whether such a file is worth writing is the caller's call.
 */
export function splitFrmDirections(anim: IndexedAnimation): IndexedAnimation[] {
    return FRM_FACINGS.map((_, d) => {
        const refs = anim.sequences[d]?.frameRefs ?? [];
        const frames: Frame[] = [];
        for (const ref of refs) {
            const frame = anim.frames[ref];
            if (frame !== undefined) frames.push(frame);
        }
        const frameRefs = frames.map((__, i) => i);
        const x = anim.meta.dirOffsetsX?.[d] ?? 0;
        const y = anim.meta.dirOffsetsY?.[d] ?? 0;
        return {
            palette: anim.palette,
            frames,
            sequences: FRM_FACINGS.map((facing) => ({ frameRefs, facing })),
            meta: {
                ...anim.meta,
                sourceFormat: "frm",
                directionLayout: "frm6",
                dirOffsetsX: FRM_FACINGS.map(() => x),
                dirOffsetsY: FRM_FACINGS.map(() => y),
            },
        };
    });
}
