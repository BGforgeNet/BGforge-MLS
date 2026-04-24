/**
 * Shared signature formatting utilities.
 * Single source of truth for signature string format across all code paths.
 */

/** Parameter in a signature. */
export interface SignatureParam {
    name: string;
    type?: string;
    defaultValue?: string;
}

/** Structured signature data. */
interface SignatureData {
    name: string;
    /** Prefix before name: "void ", "int ", "procedure ", "macro ", or "" */
    prefix: string;
    params: SignatureParam[];
}

/**
 * Format a signature from structured data.
 * Single formatter ensures consistent output across all code paths.
 *
 * Examples:
 * - { name: "foo", prefix: "void ", params: [{name: "x", type: "int"}] } → "void foo(int x)"
 * - { name: "bar", prefix: "procedure ", params: [] } → "procedure bar"
 * - { name: "baz", prefix: "", params: [{name: "a"}, {name: "b"}] } → "baz(a, b)"
 */
export function formatSignature(sig: SignatureData): string {
    if (sig.params.length === 0) {
        return `${sig.prefix}${sig.name}`;
    }
    const paramStrs = sig.params.map((p) => {
        let s = p.type ? `${p.type} ${p.name}` : p.name;
        if (p.defaultValue) s += ` = ${p.defaultValue}`;
        return s;
    });
    return `${sig.prefix}${sig.name}(${paramStrs.join(", ")})`;
}
