/**
 * Which arguments of an engine call are TLK string references, read off the signature the data already carries
 * (`DisplayString(O:Object, StrRef:String)`).
 *
 * Shared because the answer is derived at build time (the generator emits a name -> indexes map) but the rule
 * belongs with the data format, not with either consumer.
 */

/** Parameter type prefix marking a TLK string reference. The TYPE decides, never the parameter's name. */
const STRREF_TYPE_PREFIX = "StrRef:";

/**
 * The argument positions a signature declares as strrefs, in order. Empty when it declares none - which is the
 * overwhelming majority, so callers can treat an empty result as "nothing to do here".
 */
export function strRefParamIndexes(detail: string): number[] {
    const open = detail.indexOf("(");
    const close = detail.lastIndexOf(")");
    if (open === -1 || close < open) return [];
    const inner = detail.slice(open + 1, close).trim();
    if (inner === "") return [];
    const indexes: number[] = [];
    inner.split(",").forEach((param, index) => {
        if (param.trim().startsWith(STRREF_TYPE_PREFIX)) indexes.push(index);
    });
    return indexes;
}
