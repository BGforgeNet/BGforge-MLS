/**
 * Building a RegExp from a name that the text being matched owns (an identifier, a path, a keyword).
 * Escaping is one helper so no site interpolates a name raw: `$` in a TypeScript identifier is an anchor, `.` a
 * wildcard, and either silently changes what the pattern matches.
 */

/** Escape `s` so a RegExp built from it matches `s` literally. */
export function escapeRegex(s: string): string {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex source matching the identifier `name` only as a whole identifier: not glued to a word character or `$`
 * on either side. `\b` cannot say this, because `$` is not a word character to it: `\b` before a name that starts
 * with `$` needs a word character right before it, and `\bx` matches inside `$x`.
 */
export function wholeIdentifier(name: string): string {
    return `(?<![\\w$])${escapeRegex(name)}(?![\\w$])`;
}
