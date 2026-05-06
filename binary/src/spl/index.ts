/**
 * Infinity Engine SPL v1 parser. Mirrors ITM v1; abilities/effects share
 * the on-wire layout with ITM via `binary/src/ie-common/specs`.
 */

import { BufferReader } from "typed-binary";
import { walkStruct } from "../spec/walk-display";
import { effectSpec } from "../ie-common/specs";
import { EFFECT_SIZE, bytesEqual } from "../ie-common/types";
import type { BinaryParser, ParseOptions, ParseResult, ParsedField, ParsedGroup } from "../types";
import {
    effectSchema,
    splAbilitySchema,
    splHeaderSchema,
    type EffectData,
    type SplAbilityData,
    type SplHeaderData,
} from "./schemas";
import { splHeaderSpec } from "./specs/header";
import { splAbilitySpec } from "./specs/ability";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE, SPL_SIGNATURE, SPL_VERSION_V1 } from "./types";
import type { SplCanonicalDocument } from "./canonical-schemas";
import { serializeSpl } from "./serializer";

const splHeaderPresentation = {} as const;
const abilityPresentation = {} as const;
const effectPresentation = {} as const;

const FORMAT_ID = "spl";
const FORMAT_NAME = "Infinity Engine SPL v1";

function group(name: string, fields: (ParsedField | ParsedGroup)[]): ParsedGroup {
    return { name, fields, expanded: true };
}

function readerAt(data: Uint8Array, offset: number): BufferReader {
    return new BufferReader(data.buffer, { byteOffset: data.byteOffset + offset });
}

function parseHeader(data: SplHeaderData): ParsedGroup {
    return walkStruct(splHeaderSpec, splHeaderPresentation, 0, data, "SPL Header");
}

class SplParser implements BinaryParser {
    readonly id = FORMAT_ID;
    readonly name = FORMAT_NAME;
    readonly extensions = ["spl"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: group("SPL File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        if (data.byteLength < SPL_HEADER_SIZE) {
            return this.fail(`File too small: ${data.byteLength} bytes, need at least ${SPL_HEADER_SIZE} for header`);
        }

        const signature = Array.from(data.subarray(0, 4));
        if (!bytesEqual(signature, [...SPL_SIGNATURE])) {
            return this.fail(`Not an SPL file: signature ${JSON.stringify(String.fromCharCode(...signature))}`);
        }
        const version = Array.from(data.subarray(4, 8));
        if (!bytesEqual(version, [...SPL_VERSION_V1])) {
            return this.fail(
                `Unsupported SPL version: ${JSON.stringify(String.fromCharCode(...version))} (only V1 is supported)`,
            );
        }

        const header: SplHeaderData = splHeaderSchema.read(readerAt(data, 0));

        const abilitiesOffset = header.extendedHeadersOffset;
        const abilityCount = header.extendedHeadersCount;
        const abilitiesEnd = abilitiesOffset + abilityCount * SPL_ABILITY_SIZE;
        if (abilitiesEnd > data.byteLength) {
            return this.fail(
                `Abilities extend past EOF: 0x${abilitiesOffset.toString(16)} + ${abilityCount}*0x${SPL_ABILITY_SIZE.toString(16)} > size`,
            );
        }
        const abilities: SplAbilityData[] = [];
        for (let i = 0; i < abilityCount; i++) {
            abilities.push(splAbilitySchema.read(readerAt(data, abilitiesOffset + i * SPL_ABILITY_SIZE)));
        }

        const effectsOffset = header.featureBlocksOffset;
        const effectsBytes = data.byteLength - effectsOffset;
        if (effectsBytes < 0 || effectsBytes % EFFECT_SIZE !== 0) {
            return this.fail(
                `Effects region misaligned: ${effectsBytes} bytes past 0x${effectsOffset.toString(16)} not a multiple of 0x${EFFECT_SIZE.toString(16)}`,
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
                    splAbilitySpec,
                    abilityPresentation,
                    abilitiesOffset + i * SPL_ABILITY_SIZE,
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

        const document: SplCanonicalDocument = { header, abilities, effects };

        return {
            format: this.id,
            formatName: this.name,
            root: group("SPL File", [headerGroup, abilitiesGroup, effectsGroup]),
            document,
        };
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeSpl(result);
    }
}

export const splParser = new SplParser();
