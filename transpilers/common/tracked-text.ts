/**
 * Emitted text that remembers where each of its lines came from.
 *
 * An emitter assembles its output from chunks that do not line up with lines: one chunk can carry several
 * lines, and several chunks can land on one. Tracking provenance per chunk and resolving to lines at the
 * end is what lets a diagnostic reported against the generated file be traced back to the source - the
 * emitter is the only place that still knows the correspondence, since nothing downstream can recover it.
 *
 * A line belongs to the chunk that STARTED it. Emitters build a line piecewise - a keyword, then its
 * arguments - and the opening chunk is the one that says what the line is; crediting the closing chunk
 * instead would name whatever happened to terminate it.
 *
 * The origin is whatever the emitter knows: a 0-based input line for one reading a single text, or a
 * file-and-line pair for one assembling from several files.
 */

/** A line's origin as a 0-based line of the emitter's single input - what one-text emitters use. */
export type LineOrigin = number | undefined;

/** Emitted text, and the origin each of its lines came from; `undefined` where the chunk carried none. */
export interface EmittedText<Origin = number> {
    text: string;
    origins: readonly (Origin | undefined)[];
}

/** One already-emitted piece of output, and where it came from. */
export interface TrackedChunk<Origin = number> {
    text: string;
    origin?: Origin;
}

/**
 * Join chunks with a separator, attributing every line a chunk produced to that chunk.
 *
 * For emitters that build their output bottom-up as plain strings and assemble it with `join`: the
 * assembly points are where provenance is still known, so tracking there keeps the leaves untouched. The
 * granularity is therefore the chunk - every line of one names the same origin.
 */
export function joinTracked<Origin>(chunks: readonly TrackedChunk<Origin>[], separator: string): EmittedText<Origin> {
    const out = new TrackedText<Origin>();
    chunks.forEach((chunk, index) => {
        if (index > 0) out.add(separator, chunk.origin);
        out.add(chunk.text, chunk.origin);
    });
    return { text: out.text, origins: out.origins };
}

export class TrackedText<Origin = number> {
    private readonly chunks: string[] = [];
    private readonly lineOrigins: (Origin | undefined)[] = [];
    /** Whether the text so far ends mid-line, in which case the next chunk joins the line already open. */
    private lineOpen = false;

    /** Append text, attributing every line it opens to `origin`. */
    add(text: string, origin?: Origin): void {
        if (text === "") return;
        this.chunks.push(text);

        // Count the lines this chunk STARTS, which is what needs an origin recorded. Its segments are one
        // per line it touches; the first continues a line already open, and a trailing empty segment is
        // the tail of a chunk ending in a newline, which starts nothing.
        const segments = text.split("\n");
        let started = segments.length;
        if (this.lineOpen) started--;
        if (segments[segments.length - 1] === "") started--;
        for (let i = 0; i < started; i++) this.lineOrigins.push(origin);

        this.lineOpen = !text.endsWith("\n");
    }

    /**
     * Append text that already carries its own per-line origins, keeping them.
     *
     * For an emitter that assembles bottom-up: an inner piece has already worked out where each of its
     * lines came from, and re-deriving that at the outer level would throw the answer away. Where a line
     * is still open, the piece's first line joins it and keeps the origin that line already has.
     */
    addAll(emitted: EmittedText<Origin>): void {
        if (emitted.text === "") return;
        this.chunks.push(emitted.text);
        const origins = this.lineOpen ? emitted.origins.slice(1) : emitted.origins;
        this.lineOrigins.push(...origins);
        this.lineOpen = !emitted.text.endsWith("\n");
    }

    /** The assembled text. */
    get text(): string {
        return this.chunks.join("");
    }

    /** For each line of `text`, the origin it came from. */
    get origins(): readonly (Origin | undefined)[] {
        return this.lineOrigins;
    }
}
