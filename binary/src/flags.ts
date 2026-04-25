/**
 * Bitflag activation semantics shared across readers and renderers.
 *
 * `activation` distinguishes three interpretation modes for a flag bit:
 * - `set`   — flag is active when the bit is set in rawValue
 * - `clear` — flag is active when the bit is clear (and, for bitValue 0, when rawValue is non-zero)
 * - `equal` — flag is active when rawValue equals bitValue (for enum-like bit groups)
 */

export function isFlagActive(rawValue: number, bitValue: number, activation: "set" | "clear" | "equal"): boolean {
    if (activation === "equal") {
        return rawValue === bitValue;
    }

    if (bitValue === 0) {
        return activation === "clear" ? rawValue !== 0 : rawValue === 0;
    }

    const isSet = (rawValue & bitValue) !== 0;
    return activation === "set" ? isSet : !isSet;
}
