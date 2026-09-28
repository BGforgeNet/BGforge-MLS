/**
 * The size, signature and version refusals the IE parsers share, one sentence per format: what a user sees in
 * the editor when a file is not the format its extension claims.
 */

import { describe, expect, it } from "vitest";
import type { BinaryParser } from "../src/types";
import { creParser } from "../src/cre";
import { effParser } from "../src/eff";
import { itmParser } from "../src/itm";
import { splParser } from "../src/spl";
import { dlgParser } from "../src/dlg";
import { CRE_HEADER_SIZE } from "../src/cre/types";
import { EFF_TOTAL_SIZE } from "../src/eff/types";
import { ITM_HEADER_SIZE } from "../src/itm/types";
import { DLG_HEADER_SIZE } from "../src/dlg/specs/header";

/** `size` bytes opening with `prefix`, zero-filled after it. */
function file(prefix: string, size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(new TextEncoder().encode(prefix));
    return bytes;
}

const refusal = (parser: BinaryParser, bytes: Uint8Array) => parser.parse(bytes).errors?.[0];

describe("IE parse preamble", () => {
    it.each([
        [creParser, CRE_HEADER_SIZE, "CRE V1.0", "Not a CRE file", "Unsupported CRE version", "V1.0"],
        [effParser, EFF_TOTAL_SIZE, "EFF V2.0", "Not an EFF file", "Unsupported EFF version", "V2.0"],
        [itmParser, ITM_HEADER_SIZE, "ITM V1  ", "Not an ITM file", "Unsupported ITM version", "V1"],
        [splParser, ITM_HEADER_SIZE, "SPL V1  ", "Not an SPL file", "Unsupported SPL version", "V1"],
        [dlgParser, DLG_HEADER_SIZE, "DLG V1.0", "Not a DLG file", "Unsupported DLG version", "V1.0"],
    ] as const)(
        "%o refuses a wrong signature and a wrong version by name",
        (parser, size, good, notIt, badVersion, v) => {
            expect(refusal(parser, file(`XXXX${good.slice(4)}`, size))).toBe(`${notIt}: signature "XXXX"`);
            expect(refusal(parser, file(`${good.slice(0, 4)}V9.9`, size))).toBe(
                `${badVersion}: "V9.9" (only ${v} is supported)`,
            );
        },
    );

    it("refuses a file shorter than the header, naming both sizes", () => {
        expect(refusal(creParser, file("CRE V1.0", 10))).toBe(
            `File too small: 10 bytes, need at least ${CRE_HEADER_SIZE} for header`,
        );
        expect(refusal(itmParser, file("ITM V1  ", 10))).toBe(
            `File too small: 10 bytes, need at least ${ITM_HEADER_SIZE} for header`,
        );
    });
});
