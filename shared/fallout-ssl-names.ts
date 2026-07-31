/**
 * How Fallout SSL identifiers compare.
 *
 * The language itself binds names case-insensitively - procedures, variables and builtins alike. Verified
 * against the bundled sslc, which compiles `call Node005` against `procedure NOde005`, `My_Flag := 1` against
 * `variable my_flag`, and `Display_Msg(...)`; a genuinely undefined target fails loudly ("No code for
 * procedure", "Undefined symbol"). Real content relies on it: across the Fallout corpus 72 procedure/reference
 * pairs disagree on casing, and 22 references to the reserved `Node998`/`Node999` sinks are spelled `NOde999`
 * or `node999`, all in shipped, working scripts.
 *
 * The PREPROCESSOR is the exception, and it is not a detail: `#define` names and macro parameters are matched
 * case-sensitively - sslc rejects `my_macro` against `#define MY_MACRO`. That is also why the option/message
 * builtins (`NOption`, `Reply`) compare exactly: they are macros, not procedures. So a comparison folds only
 * when the thing being named is an SSL construct, never a preprocessor one.
 */

/** The identity key for an SSL identifier. Locale-independent: `toLowerCase` never applies Turkish-I. */
export function sslNameKey(name: string): string {
    return name.toLowerCase();
}

/**
 * Whether two SSL identifiers name the same construct. Absent operands never match, so a node that carries no
 * name is not silently equal to one that does.
 */
export function sslNamesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    return a !== null && a !== undefined && b !== null && b !== undefined && sslNameKey(a) === sslNameKey(b);
}

/**
 * The value a map keyed by AUTHORED SSL name holds for `name`. Those maps stay keyed as the source spells each
 * entry, because the key is what gets displayed (an outline entry, a hover title); only the lookup folds. Exact
 * hits short-circuit, so the scan runs only for the rarer case-divergent reference.
 */
export function sslMapGet<T>(map: ReadonlyMap<string, T>, name: string): T | undefined {
    const direct = map.get(name);
    if (direct !== undefined) return direct;
    const key = sslNameKey(name);
    for (const [candidate, value] of map) {
        if (sslNameKey(candidate) === key) return value;
    }
    return undefined;
}
