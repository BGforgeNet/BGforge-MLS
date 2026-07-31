/**
 * How Fallout SSL procedure names compare.
 *
 * SSL resolves a procedure reference case-insensitively: `call Node005` binds to `procedure NOde005`, which the
 * bundled sslc compiles without complaint (a genuinely undefined target fails with "No code for procedure").
 * Real content relies on it - across the Fallout corpus 72 procedure/reference pairs disagree on casing, and 22
 * references to the reserved `Node998`/`Node999` sinks are spelled `NOde999` or `node999`, all in shipped,
 * working scripts.
 *
 * So every comparison of one SSL procedure name against another goes through `sslNameKey`, and the dialog
 * parser resolves each reference to its definition's spelling once, at parse time, rather than leaving each
 * consumer to fold for itself. Note the asymmetry with the option/message builtins (`NOption`, `Reply`): those
 * are preprocessor macros, whose names the preprocessor DOES match case-sensitively, and the corpus spells all
 * of them canonically - so those comparisons stay exact.
 */

/** The identity key for an SSL procedure name. Locale-independent: `toLowerCase` never applies Turkish-I. */
export function sslNameKey(name: string): string {
    return name.toLowerCase();
}
