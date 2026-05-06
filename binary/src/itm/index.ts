/**
 * Infinity Engine ITM v1 parser.
 *
 * Decodes the 0x72-byte header, the variable-length abilities array
 * (extended headers, 0x38 each) at `header.extendedHeadersOffset`, and the
 * flat effects array (feature blocks, 0x30 each) at
 * `header.featureBlocksOffset`. Effects share the on-wire layout with SPL
 * via `binary/src/ie-common/specs/effect`; abilities differ between the
 * two formats and live in each format's own `specs/ability.ts`.
 */

import { BufferReader } from "typed-binary";
import { walkStruct } from "../spec/walk-display";
import { effectSpec } from "../ie-common/specs";
import { EFFECT_SIZE, bytesEqual } from "../ie-common/types";
import type { BinaryParser, ParseOptions, ParseResult, ParsedField, ParsedGroup } from "../types";
import {
    effectSchema,
    itmAbilitySchema,
    itmHeaderSchema,
    type EffectData,
    type ItmAbilityData,
    type ItmHeaderData,
} from "./schemas";
import { itmHeaderSpec } from "./specs/header";
import { itmAbilitySpec } from "./specs/ability";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE, ITM_SIGNATURE, ITM_VERSION_V1 } from "./types";
import type { ItmCanonicalDocument } from "./canonical-schemas";
import { serializeItm } from "./serializer";

/**
 * Empty presentation tables — `humanize(fieldName)` supplies labels in the
 * display tree. Hand-written overrides for flag/enum tables and friendlier
 * labels can be added here when needed without affecting wire round-trip.
 */
const itmHeaderPresentation = {} as const;
const abilityPresentation = {} as const;
const effectPresentation = {} as const;

const FORMAT_ID = "itm";
const FORMAT_NAME = "Infinity Engine ITM v1";

function group(name: string, fields: (ParsedField | ParsedGroup)[]): ParsedGroup {
    return { name, fields, expanded: true };
}

function readerAt(data: Uint8Array, offset: number): BufferReader {
    return new BufferReader(data.buffer, { byteOffset: data.byteOffset + offset });
}

function parseHeader(data: ItmHeaderData): ParsedGroup {
    return walkStruct(itmHeaderSpec, itmHeaderPresentation, 0, data, "ITM Header");
}

class ItmParser implements BinaryParser {
    readonly id = FORMAT_ID;
    readonly name = FORMAT_NAME;
    readonly extensions = ["itm"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: group("ITM File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        if (data.byteLength < ITM_HEADER_SIZE) {
            return this.fail(`File too small: ${data.byteLength} bytes, need at least ${ITM_HEADER_SIZE} for header`);
        }

        const signature = Array.from(data.subarray(0, 4));
        if (!bytesEqual(signature, [...ITM_SIGNATURE])) {
            return this.fail(`Not an ITM file: signature ${JSON.stringify(String.fromCharCode(...signature))}`);
        }
        const version = Array.from(data.subarray(4, 8));
        if (!bytesEqual(version, [...ITM_VERSION_V1])) {
            return this.fail(
                `Unsupported ITM version: ${JSON.stringify(String.fromCharCode(...version))} (only V1 is supported)`,
            );
        }

        const header: ItmHeaderData = itmHeaderSchema.read(readerAt(data, 0));

        // Abilities live at header.extendedHeadersOffset, count given by header.
        const abilitiesOffset = header.extendedHeadersOffset;
        const abilityCount = header.extendedHeadersCount;
        const abilitiesEnd = abilitiesOffset + abilityCount * ITM_ABILITY_SIZE;
        if (abilitiesEnd > data.byteLength) {
            return this.fail(
                `Abilities extend past EOF: offset 0x${abilitiesOffset.toString(16)} + ${abilityCount}*0x${ITM_ABILITY_SIZE.toString(16)} = 0x${abilitiesEnd.toString(16)} > size 0x${data.byteLength.toString(16)}`,
            );
        }
        const abilities: ItmAbilityData[] = [];
        for (let i = 0; i < abilityCount; i++) {
            abilities.push(itmAbilitySchema.read(readerAt(data, abilitiesOffset + i * ITM_ABILITY_SIZE)));
        }

        // Effects: total count is determined by file size minus the offset, since
        // the header only carries the *equipping* effect range. Per-ability ranges
        // index into the same flat array.
        const effectsOffset = header.featureBlocksOffset;
        const effectsBytes = data.byteLength - effectsOffset;
        if (effectsBytes < 0 || effectsBytes % EFFECT_SIZE !== 0) {
            return this.fail(
                `Effects region misaligned: ${effectsBytes} bytes past offset 0x${effectsOffset.toString(16)} is not a multiple of 0x${EFFECT_SIZE.toString(16)}`,
            );
        }
        const effectCount = effectsBytes / EFFECT_SIZE;
        const effects: EffectData[] = [];
        for (let i = 0; i < effectCount; i++) {
            effects.push(effectSchema.read(readerAt(data, effectsOffset + i * EFFECT_SIZE)));
        }

        const headerGroup = parseHeader(header);
        const abilitiesGroup = group(
            "Abilities",
            abilities.map((ability, i) =>
                walkStruct(
                    itmAbilitySpec,
                    abilityPresentation,
                    abilitiesOffset + i * ITM_ABILITY_SIZE,
                    ability,
                    `Ability ${i + 1}`,
                ),
            ),
        );
        const effectsGroup = group(
            "Effects",
            effects.map((effect, i) =>
                walkStruct(effectSpec, effectPresentation, effectsOffset + i * EFFECT_SIZE, effect, `Effect ${i + 1}`),
            ),
        );

        const document: ItmCanonicalDocument = { header, abilities, effects };

        return {
            format: this.id,
            formatName: this.name,
            root: group("ITM File", [headerGroup, abilitiesGroup, effectsGroup]),
            document,
        };
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeItm(result);
    }
}

export const itmParser = new ItmParser();
