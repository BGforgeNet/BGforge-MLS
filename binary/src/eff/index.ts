/**
 * Infinity Engine EFF v2 parser. Single fixed-size record: 8-byte header
 * (signature 'EFF ' + version 'V2.0') + 264-byte body. Used by BG2/IWDEE
 * for sub-effects spawned by spell opcodes that reference an external EFF.
 */

import { BufferReader } from "typed-binary";
import { walkStruct } from "../spec/walk-display";
import { bytesEqual } from "../ie-common/types";
import type { BinaryParser, ParseOptions, ParseResult, ParsedField, ParsedGroup } from "../types";
import { effBodySchema, effHeaderSchema, type EffBodyData, type EffHeaderData } from "./schemas";
import { effBodySpecAnnotated } from "./specs/body.overrides";
import { effHeaderSpec } from "./specs/header";
import { EFF_HEADER_SIZE, EFF_SIGNATURE, EFF_TOTAL_SIZE, EFF_VERSION_V2 } from "./types";
import type { EffCanonicalDocument } from "./canonical-schemas";
import { serializeEff } from "./serializer";

const effHeaderPresentation = {} as const;
const effBodyPresentation = {} as const;

const FORMAT_ID = "eff";
const FORMAT_NAME = "Infinity Engine EFF v2";

function group(name: string, fields: (ParsedField | ParsedGroup)[]): ParsedGroup {
    return { name, fields, expanded: true };
}

function readerAt(data: Uint8Array, offset: number): BufferReader {
    return new BufferReader(data.buffer, { byteOffset: data.byteOffset + offset });
}

class EffParser implements BinaryParser {
    readonly id = FORMAT_ID;
    readonly name = FORMAT_NAME;
    readonly extensions = ["eff"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: group("EFF File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        if (data.byteLength !== EFF_TOTAL_SIZE) {
            return this.fail(
                `Wrong EFF v2 file size: got ${data.byteLength} bytes, expected ${EFF_TOTAL_SIZE} (${EFF_HEADER_SIZE} header + ${EFF_TOTAL_SIZE - EFF_HEADER_SIZE} body)`,
            );
        }

        const signature = Array.from(data.subarray(0, 4));
        if (!bytesEqual(signature, [...EFF_SIGNATURE])) {
            return this.fail(`Not an EFF file: signature ${JSON.stringify(String.fromCodePoint(...signature))}`);
        }
        const version = Array.from(data.subarray(4, 8));
        if (!bytesEqual(version, [...EFF_VERSION_V2])) {
            return this.fail(
                `Unsupported EFF version: ${JSON.stringify(String.fromCodePoint(...version))} (only V2.0 is supported)`,
            );
        }

        const header: EffHeaderData = effHeaderSchema.read(readerAt(data, 0));
        const body: EffBodyData = effBodySchema.read(readerAt(data, EFF_HEADER_SIZE));

        const headerGroup = walkStruct(effHeaderSpec, effHeaderPresentation, 0, header, "EFF Header");
        const bodyGroup = walkStruct(effBodySpecAnnotated, effBodyPresentation, EFF_HEADER_SIZE, body, "EFF Body");

        const document: EffCanonicalDocument = { header, body };

        return {
            format: this.id,
            formatName: this.name,
            root: group("EFF File", [headerGroup, bodyGroup]),
            document,
        };
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeEff(result);
    }
}

export const effParser = new EffParser();
