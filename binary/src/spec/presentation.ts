/**
 * Per-field UI presentation overrides for the binary editor / display tree.
 *
 * Lives in a separate layer from `FieldSpec` (the data layer): representation
 * concerns (label override, unit hint, hex/decimal display, editable bit) do
 * not affect what the bytes mean.
 */
export interface FieldPresentation {
    readonly label?: string;
    readonly unit?: string;
    /**
     * Display format hint:
     * - `decimal` (default) / `hex32`: scalar number rendering.
     * - `ascii`: u8[N] array rendered as ASCII string (NUL bytes dropped, trailing
     *   whitespace preserved). Used for fixed-byte name fields like resrefs and
     *   format signatures (e.g. `"ITM "`, `"EFF_M01"`).
     */
    readonly format?: "decimal" | "hex32" | "ascii";
    readonly editable?: boolean;
}

export type StructPresentation<T> = Partial<Record<keyof T, FieldPresentation>>;

/**
 * Convert a camelCase field name to a Title Case display label. Used as a
 * fallback when no `label` override is provided. Handles consecutive uppercase
 * runs as acronyms ("acID" -> "Ac ID", not "Ac I D").
 *
 * NB: humanize does NOT separate a trailing slot digit ("parameter1" stays
 * "Parameter1"). It is tempting to, but the humanized label is load-bearing -
 * the IE effect relationship overlay matches parameter fields by this exact
 * string. Per-field display tweaks (e.g. "Kit Usability 1") belong in a
 * `labels` override, which changes only the display name, not this key.
 */
/** Field names come from the static specs, so the same handful recur once per field instance. */
const humanizeCache = new Map<string, string>();

export function humanize(fieldName: string): string {
    const cached = humanizeCache.get(fieldName);
    if (cached !== undefined) return cached;

    const label = fieldName
        .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/^(.)/, (c) => c.toUpperCase());
    humanizeCache.set(fieldName, label);
    return label;
}

/**
 * Convert a display label to the camelCase segment used in a field's semantic key. Roughly the inverse of
 * `humanize`: a default label `humanize(key)` slugifies back to `key`, while a custom label slugifies to its
 * own camelCase form. Lives in this leaf (no imports) so the display walker and the presentation deriver key
 * fields identically without an import cycle.
 */
export function slugify(label: string): string {
    const normalized = label
        .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replaceAll(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toLowerCase();

    if (!normalized) {
        return "field";
    }

    const parts = normalized.split(/\s+/);
    return parts.map((part, index) => (index === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`)).join("");
}
