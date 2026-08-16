/**
 * Keeps a recompiled script's string table in the order an earlier build of it laid out.
 *
 * A string's position in the table follows the order the SOURCE mentions it, so compiling text that
 * came back out of a compiled script re-lays the table by wherever the printer happened to put each
 * literal. Nothing about the script's behaviour changes, but every offset after the first difference
 * moves, and a file saved without an edit no longer matches the one that was opened.
 *
 * Seeding the emitter with the previous order removes that: literals the new build still uses are
 * interned in the order they already had, and anything the edit introduced follows. Literals the edit
 * REMOVED are dropped rather than carried, so a table cannot accumulate strings across saves - it is
 * the previous order that is preserved, not the previous contents.
 */
export function preserveStringOrder(next: readonly string[], previous: readonly string[]): string[] {
    const wanted = new Set(next);
    const kept = previous.filter((literal) => wanted.has(literal));
    const already = new Set(kept);
    return [...kept, ...next.filter((literal) => !already.has(literal))];
}
