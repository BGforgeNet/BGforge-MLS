/** What a multi-column key/value grid measured as once rendered at one candidate column count. */
export interface KvFitMeasure {
    /** Every sized control renders at the full width its class declares. */
    readonly holds: boolean;
    /** The grid sits on one line with the other blocks of its panel (a flags box). */
    readonly besideSiblings: boolean;
}

export interface KvFit {
    readonly columns: number;
    /** One column with each label above its control. */
    readonly stacked: boolean;
}

/**
 * Picks the layout of a multi-column key/value grid, measuring counts from `max` down. Shedding a column to stay
 * beside the panel's other blocks wins over a wider count that holds only because they wrapped below the grid; that
 * wrap is taken once no count fits beside them. With no count holding at all, labels go above their controls.
 */
export function pickKvFit(max: number, measureAt: (columns: number) => KvFitMeasure): KvFit {
    let wrapped = 0;
    for (let n = max; n >= 1; n--) {
        const measured = measureAt(n);
        if (!measured.holds) continue;
        if (measured.besideSiblings) return { columns: n, stacked: false };
        wrapped ||= n;
    }
    return wrapped > 0 ? { columns: wrapped, stacked: false } : { columns: 1, stacked: true };
}
