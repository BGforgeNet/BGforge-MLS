/**
 * Shared parser factory for the IE "ability + effects" formats (ITM, SPL).
 *
 * ITM v1 and SPL v1 decode identically: a fixed header, a variable-length
 * abilities array (extended headers, `abilitySize` each) at
 * `header.extendedHeadersOffset`, then a flat effects array (feature blocks,
 * `EFFECT_SIZE` each) filling the rest of the file from
 * `header.featureBlocksOffset`. Only the header/ability layouts and the format
 * identity differ; the effects layout is shared via `ie-common/specs/effect`.
 * Each format's `index.ts` binds its schemas/specs/sizes and gets a ready
 * `BinaryParser` instead of restating the parse discipline twice.
 */

import { group, readerAt } from "./parse-helpers";
import { walkStruct } from "../spec/walk-display";
import { effectPresentation, effectSpecAnnotated } from "./specs/effect.overrides";
import { EFFECT_SIZE, bytesEqual } from "./types";
import { toTypedBinarySchema, type SpecCodec } from "../spec/derive-typed-binary";
import type { SpecData, StructSpec } from "../spec/types";
import type { StructPresentation } from "../spec/presentation";
import type { BinaryParser, ParseOptions, ParseResult } from "../types";
import type { IeFormatId } from "./canonical-reader";

type EffectData = SpecData<typeof effectSpecAnnotated>;

/** The header fields every ability+effects format addresses its arrays through. */
interface IeAbilityEffectsHeader {
    readonly extendedHeadersOffset: number;
    readonly extendedHeadersCount: number;
    readonly featureBlocksOffset: number;
}

/** Wire codec + display spec + presentation for one walkable struct. */
export interface IeStructCodec<Data> {
    readonly schema: SpecCodec<Data>;
    readonly spec: StructSpec<Data>;
    readonly presentation: StructPresentation<Data>;
}

export interface IeAbilityEffectsParserConfig<HeaderData extends IeAbilityEffectsHeader, AbilityData> {
    readonly formatId: IeFormatId;
    readonly formatName: string;
    /** Short label for error messages and display-group names ("ITM" / "SPL"). */
    readonly label: string;
    /** File extension this parser handles (without dot). */
    readonly extension: string;
    readonly headerSize: number;
    readonly abilitySize: number;
    readonly signature: readonly number[];
    readonly versionV1: readonly number[];
    readonly header: IeStructCodec<HeaderData>;
    readonly ability: IeStructCodec<AbilityData>;
    readonly serialize: (result: ParseResult) => Uint8Array;
    /** Layout variant id stamped on the parse result so the declarative layout selects this format's layout. */
    readonly variantId?: string;
}

// Shared effects wire codec. `toTypedBinarySchema` caches by spec reference, so
// this is the same instance each format's `schemas.ts` derives from
// `effectSpecAnnotated`; building it here keeps the factory self-contained.
const effectSchema = toTypedBinarySchema(effectSpecAnnotated);
// The shared feature-block/EFF-v1 presentation (`effectPresentation`) is imported so ITM, SPL, and CRE-v0
// effects render identically; `humanize(fieldName)` supplies labels for fields it does not override. The
// per-format header/ability presentations are passed in by each caller.

export function createIeAbilityEffectsParser<HeaderData extends IeAbilityEffectsHeader, AbilityData>(
    config: IeAbilityEffectsParserConfig<HeaderData, AbilityData>,
): BinaryParser {
    const {
        formatId,
        formatName,
        label,
        extension,
        headerSize,
        abilitySize,
        signature,
        versionV1,
        header: headerCodec,
        ability: abilityCodec,
        serialize,
        variantId,
    } = config;

    const fail = (message: string): ParseResult => ({
        format: formatId,
        formatName,
        root: group(`${label} File`, []),
        errors: [message],
    });

    const parse = (data: Uint8Array, _options?: ParseOptions): ParseResult => {
        if (data.byteLength < headerSize) {
            return fail(`File too small: ${data.byteLength} bytes, need at least ${headerSize} for header`);
        }

        const sig = [...data.subarray(0, 4)];
        if (!bytesEqual(sig, signature)) {
            return fail(`Not an ${label} file: signature ${JSON.stringify(String.fromCodePoint(...sig))}`);
        }
        const version = [...data.subarray(4, 8)];
        if (!bytesEqual(version, versionV1)) {
            return fail(
                `Unsupported ${label} version: ${JSON.stringify(String.fromCodePoint(...version))} (only V1 is supported)`,
            );
        }

        const header: HeaderData = headerCodec.schema.read(readerAt(data, 0));

        // Abilities live at header.extendedHeadersOffset, count given by header.
        // The product `abilityCount * abilitySize` cannot overflow JS safe
        // integers: the codec types abilityCount as uint32 (<= 4 294 967 295) and
        // abilitySize is a small fixed constant, so the maximum product is well
        // below 2^48 - inside double-precision exactness - and the bounds check
        // below stays meaningful even for adversarial inputs.
        const abilitiesOffset = header.extendedHeadersOffset;
        const abilityCount = header.extendedHeadersCount;
        const abilitiesEnd = abilitiesOffset + abilityCount * abilitySize;
        if (abilitiesEnd > data.byteLength) {
            return fail(
                `Abilities extend past EOF: offset 0x${abilitiesOffset.toString(16)} + ${abilityCount}*0x${abilitySize.toString(16)} = 0x${abilitiesEnd.toString(16)} > size 0x${data.byteLength.toString(16)}`,
            );
        }
        const abilities: AbilityData[] = [];
        for (let i = 0; i < abilityCount; i++) {
            abilities.push(abilityCodec.schema.read(readerAt(data, abilitiesOffset + i * abilitySize)));
        }

        // Effects: total count is determined by file size minus the offset, since
        // the header only carries the *equipping* effect range. Per-ability ranges
        // index into the same flat array.
        const effectsOffset = header.featureBlocksOffset;
        const effectsBytes = data.byteLength - effectsOffset;
        if (effectsBytes < 0 || effectsBytes % EFFECT_SIZE !== 0) {
            return fail(
                `Effects region misaligned: ${effectsBytes} bytes past offset 0x${effectsOffset.toString(16)} is not a multiple of 0x${EFFECT_SIZE.toString(16)}`,
            );
        }
        const effectCount = effectsBytes / EFFECT_SIZE;
        const effects: EffectData[] = [];
        for (let i = 0; i < effectCount; i++) {
            effects.push(effectSchema.read(readerAt(data, effectsOffset + i * EFFECT_SIZE)));
        }

        const headerGroup = walkStruct(headerCodec.spec, headerCodec.presentation, 0, header, `${label} Header`);
        const abilitiesGroup = group(
            "Abilities",
            abilities.map((ability, i) =>
                walkStruct(
                    abilityCodec.spec,
                    abilityCodec.presentation,
                    abilitiesOffset + i * abilitySize,
                    ability,
                    `Ability ${i + 1}`,
                ),
            ),
        );
        const effectsGroup = group(
            "Effects",
            effects.map((effect, i) =>
                walkStruct(
                    effectSpecAnnotated,
                    effectPresentation,
                    effectsOffset + i * EFFECT_SIZE,
                    effect,
                    `Effect ${i + 1}`,
                ),
            ),
        );

        return {
            format: formatId,
            formatName,
            ...(variantId !== undefined && { variantId }),
            root: group(`${label} File`, [headerGroup, abilitiesGroup, effectsGroup]),
            // cast: the constructed { header, abilities, effects } is structurally each
            // format's canonical document, but in this generic factory HeaderData/AbilityData
            // are opaque so TS can't match it to the closed BinaryCanonicalDocument union.
            // Each caller binds the concrete schemas, and the same per-format zod schema
            // validates this exact shape on read-back.
            document: { header, abilities, effects } as unknown as ParseResult["document"],
        };
    };

    return {
        id: formatId,
        name: formatName,
        extensions: [extension],
        // Intrinsic to this factory rather than per-format config: it builds only Infinity Engine formats.
        family: "infinity-engine",
        parse,
        serialize,
    };
}
