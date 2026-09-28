/**
 * Low-level parse helpers shared by the Infinity Engine format parsers
 * (ITM/SPL/EFF/CRE). These were previously re-declared identically in each
 * parser's index.ts.
 *
 * `readerAt` is little-endian (IE byte order), so the Fallout PRO/MAP parsers
 * deliberately do not share it; `map/parse-helpers.ts` keeps its own configurable
 * `makeGroup` rather than this always-expanded `group`.
 */

import { BufferReader } from "typed-binary";
import type { ParsedField, ParsedGroup } from "../types";
import { bytesEqual } from "./types";

/** Build an expanded display group from already-parsed fields/subgroups. */
export function group(name: string, fields: (ParsedField | ParsedGroup)[]): ParsedGroup {
    return { name, fields, expanded: true };
}

/** A little-endian reader positioned `offset` bytes into `data`. */
export function readerAt(data: Uint8Array, offset: number): BufferReader {
    return new BufferReader(data.buffer, { byteOffset: data.byteOffset + offset });
}

const text = (bytes: readonly number[]): string => String.fromCodePoint(...bytes);

/**
 * Why a file's 8-byte signature and version are not the ones `label` reads, or undefined when they are. The
 * size check stays with each parser, since EFF v2 needs an exact size where the others need a minimum.
 */
export function iePreambleError(
    data: Uint8Array,
    label: string,
    signature: readonly number[],
    version: readonly number[],
): string | undefined {
    const actualSignature = [...data.subarray(0, 4)];
    if (!bytesEqual(actualSignature, signature)) {
        // The article follows the first letter's spoken name, as a reader says an acronym: "an ITM", "a CRE".
        const article = /^[AEFHILMNORSX]/.test(label) ? "an" : "a";
        return `Not ${article} ${label} file: signature ${JSON.stringify(text(actualSignature))}`;
    }
    const actualVersion = [...data.subarray(4, 8)];
    if (!bytesEqual(actualVersion, version)) {
        return `Unsupported ${label} version: ${JSON.stringify(text(actualVersion))} (only ${text(version).trim()} is supported)`;
    }
    return undefined;
}
