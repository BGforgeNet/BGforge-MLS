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

/** Build an expanded display group from already-parsed fields/subgroups. */
export function group(name: string, fields: (ParsedField | ParsedGroup)[]): ParsedGroup {
    return { name, fields, expanded: true };
}

/** A little-endian reader positioned `offset` bytes into `data`. */
export function readerAt(data: Uint8Array, offset: number): BufferReader {
    return new BufferReader(data.buffer, { byteOffset: data.byteOffset + offset });
}
