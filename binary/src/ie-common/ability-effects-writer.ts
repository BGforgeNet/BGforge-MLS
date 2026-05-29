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
}

export function createIeAbilityEffectsWriter<HeaderData extends Record<string, unknown>, AbilityData>(
    config: IeAbilityEffectsWriterConfig<HeaderData, AbilityData>,
): (document: { header: HeaderData; abilities: AbilityData[]; effects: EffectData[] }) => Uint8Array {
    const { headerSize, abilitySize, headerSchema, abilitySchema, headerSpec } = config;

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
