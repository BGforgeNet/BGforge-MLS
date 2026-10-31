/**
 * What the readers pass over, and why.
 *
 * One unreadable resource must not cost a whole index or set, so the readers skip it. A skip nobody can see
 * reads as a missing animation, so each one is recorded here for the caller to show.
 */

/** A resource a reader skipped: its name as a reader would write it (`ANISND.IDS`) and what went wrong. */
export interface SkippedResource {
    resource: string;
    reason: string;
}

/** `ANISND` and `ids` -> `ANISND.IDS`. */
export function resourceName(resref: string, type: string): string {
    return `${resref}.${type.toUpperCase()}`;
}

/**
 * Whether an error says a resource's bytes are malformed, as opposed to the code reading them being wrong.
 *
 * The parsers raise plain `Error` for a bad header or table and a `RangeError` when a read runs past the end
 * of the buffer; a `TypeError` or `ReferenceError` is a defect in this code and must propagate.
 */
export function isMalformedResource(error: unknown): boolean {
    return error instanceof RangeError || (error instanceof Error && error.constructor === Error);
}

/** Record a skip into `into`, once per resource and reason; a caller that passes no list wants none. */
export function noteSkipped(into: SkippedResource[] | undefined, resource: string, error: unknown): void {
    if (into === undefined) return;
    const reason = error instanceof Error ? error.message : String(error);
    if (into.some((entry) => entry.resource === resource && entry.reason === reason)) return;
    into.push({ resource, reason });
}
