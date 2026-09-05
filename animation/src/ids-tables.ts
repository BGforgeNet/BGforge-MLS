/**
 * Reading an install's IDS tables.
 *
 * An IDS file maps a numeric engine constant to a short symbol, and several of them are keyed by hex id in
 * the same shape - `ANISND.IDS` and `ANIMATE.IDS` among them. One reader, so a second caller does not bring
 * a second parser with its own idea of which row wins.
 */

/**
 * `<hex id> <symbol> <comment>` per line, after a leading `IDS` line, latin-1.
 *
 * What the symbol MEANS is the caller's: `ANISND.IDS` gives an animation's resref prefix while
 * `ANIMATE.IDS` gives it a descriptive name, and the same id has a different symbol in each.
 */
export function readIdsCodes(bytes: Uint8Array): Map<number, string> {
    const codes = new Map<number, string>();
    for (const line of new TextDecoder("latin1").decode(bytes).split(/\r?\n/)) {
        const [id, code] = line.trim().split(/\s+/);
        if (id === undefined || code === undefined) continue;
        const value = Number.parseInt(id, 16);
        // The first key wins: an install can name one id twice, and the earlier row is the one it ships for.
        if (Number.isFinite(value) && /^0x/i.test(id) && !codes.has(value)) codes.set(value, code.toUpperCase());
    }
    return codes;
}
