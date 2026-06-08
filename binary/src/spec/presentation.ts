/**
 * Per-field UI presentation overrides for the binary editor / display tree.
 *
 * Lives in a separate layer from `FieldSpec` (the data layer): representation
 * concerns (label override, unit hint, hex/decimal display, editable bit) do
 * not affect what the bytes mean. See `tmp/binary-spec-plan.md`.
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
export function humanize(fieldName: string): string {
    return fieldName
        .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/^(.)/, (c) => c.toUpperCase());
}
