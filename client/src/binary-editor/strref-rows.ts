/**
 * Fills `strrefText` on every strref row inside a host-to-webview message.
 *
 * Rows reach the webview through several message shapes (`init`, `children`, `changeSet`, the spellbook and
 * effect-tree views), and more may follow - so this walks the message generically instead of being applied at
 * each post site, which is the shape that goes stale the moment a seventh message carries rows.
 *
 * Structurally sharing: a subtree with no strref row is returned as-is, so a record that is not from a game -
 * where the resolver answers undefined for everything - allocates nothing.
 */

/** A row carrying an unresolved string reference. Matched structurally: this module never imports the editor's
 *  Row type, so it walks messages whose row-bearing shape it does not need to know. */
interface StrrefRow {
    strref: true;
    rawValue: number;
}

function isStrrefRow(value: object): value is StrrefRow {
    return (
        "strref" in value &&
        value.strref === true &&
        "rawValue" in value &&
        typeof value.rawValue === "number" &&
        !("strrefText" in value)
    );
}

export function withResolvedStrrefs<T>(value: T, resolve: (strref: number) => string | undefined): T {
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((entry) => {
            const resolved = withResolvedStrrefs(entry, resolve);
            if (resolved !== entry) changed = true;
            return resolved;
        });
        return (changed ? next : value) as T;
    }
    if (typeof value !== "object" || value === null) return value;

    if (isStrrefRow(value)) {
        const text = resolve(value.rawValue);
        return text === undefined ? value : ({ ...value, strrefText: text } as T);
    }

    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        const resolved = withResolvedStrrefs(entry, resolve);
        if (resolved !== entry) changed = true;
        next[key] = resolved;
    }
    return (changed ? next : value) as T;
}
