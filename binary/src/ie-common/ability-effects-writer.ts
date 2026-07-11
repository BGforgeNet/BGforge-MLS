/**
 * Shared canonical-document writer factory for the IE "ability + effects"
 * formats (ITM, SPL).
 *
 * Both formats serialize the same way: recompute the derived header fields
 * (`extendedHeadersOffset/Count`, `featureBlocksOffset`) from the doc shape via
 * `enforceDerivedFields` so a hand-edited canonical doc with stale offsets
 * cannot produce a corrupt file, then lay out header + abilities + effects at
 * their computed offsets. Feature-block subset metadata
 * (`featureBlocksIndex`/`featureBlocksCount`, the *equipping* effect range) has
 * no derivation source and passes through as the user supplied it. Only the
 * header/ability layouts and sizes differ between the two formats.
 */

import { BufferWriter } from "typed-binary";
import { EFFECT_SIZE } from "./types";
import { effectSpecAnnotated } from "./specs/effect.overrides";
import { toTypedBinarySchema, type SpecCodec } from "../spec/derive-typed-binary";
import { enforceDerivedFields, type FieldSpec, type SpecData } from "../spec/types";
import { MAX_FILE_SIZES } from "../max-file-sizes";

type EffectData = SpecData<typeof effectSpecAnnotated>;

// Same shared (reference-cached) effects codec the parser factory derives.
const effectSchema = toTypedBinarySchema(effectSpecAnnotated);

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export interface IeAbilityEffectsWriterConfig<HeaderData extends Record<string, unknown>, AbilityData> {
    readonly headerSize: number;
    readonly abilitySize: number;
    readonly headerSchema: SpecCodec<HeaderData>;
    readonly abilitySchema: SpecCodec<AbilityData>;
    /** Annotated header spec, used to recompute derived structural fields. */
    readonly headerSpec: Record<string, FieldSpec>;
    /** Registry format id ("itm" / "spl"), used to look up the format's MAX_FILE_SIZES budget. */
    readonly formatId: string;
}

export function createIeAbilityEffectsWriter<HeaderData extends Record<string, unknown>, AbilityData>(
    config: IeAbilityEffectsWriterConfig<HeaderData, AbilityData>,
): (document: { header: HeaderData; abilities: AbilityData[]; effects: EffectData[] }) => Uint8Array {
    const { headerSize, abilitySize, headerSchema, abilitySchema, headerSpec, formatId } = config;

    return (document) => {
        const { abilities, effects } = document;
        const abilitiesOffset = headerSize;
        const effectsOffset = abilitiesOffset + abilities.length * abilitySize;
        const header = enforceDerivedFields(headerSpec, document.header, {
            arrays: { abilities },
            sectionOffsets: { abilities: abilitiesOffset, effects: effectsOffset },
        });

        const totalSize = Math.max(
            headerSize,
            abilitiesOffset + abilities.length * abilitySize,
            effectsOffset + effects.length * EFFECT_SIZE,
        );

        // Bound the snapshot's projected expansion to the format's real-world size
        // envelope BEFORE allocating the output buffer. A JSON snapshot's abilities/
        // effects arrays drive `totalSize` directly and carry no other cap (unlike a
        // raw binary file, which the CLI's MAX_FILE_SIZES stat check already bounds
        // on the way in) - see max-file-sizes.ts.
        const budget = MAX_FILE_SIZES[formatId];
        if (budget !== undefined && totalSize > budget) {
            throw new Error(
                `${formatId} snapshot would expand to ${totalSize} bytes ` +
                    `(abilities: ${abilities.length}, effects: ${effects.length}), exceeding the format's ` +
                    `${budget} byte budget; refusing to allocate`,
            );
        }

        const out = new Uint8Array(totalSize);
        headerSchema.write(writerAt(out, 0), header);

        for (let i = 0; i < abilities.length; i++) {
            abilitySchema.write(writerAt(out, abilitiesOffset + i * abilitySize), abilities[i]!);
        }
        for (let i = 0; i < effects.length; i++) {
            effectSchema.write(writerAt(out, effectsOffset + i * EFFECT_SIZE), effects[i]!);
        }

        return out;
    };
}
