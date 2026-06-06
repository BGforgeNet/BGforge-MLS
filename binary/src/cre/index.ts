/**
 * Infinity Engine CRE v1 parser. The header points at five variable-length
 * sections plus a fixed item-slot block; the effects table's per-record
 * size depends on the header byte at 0x0033 (`effStructureVersion`):
 *   - 0 -> EFF v1 records (0x30 bytes each, local spec)
 *   - 1 -> EFF v2 body records (0x108 bytes each, shared via ie-common)
 * Both kinds round-trip byte-identically through the canonical-doc layer.
 */

import { group, readerAt } from "../ie-common/parse-helpers";
import { walkStruct } from "../spec/walk-display";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import { bytesEqual } from "../ie-common/types";
import type { BinaryParser, ParseOptions, ParseResult, ParsedField } from "../types";
import type { CreCanonicalDocument } from "./canonical-schemas";
import {
    creEffectV1Schema,
    creEffectV2Schema,
    creHeaderSchema,
    creItemSchema,
    creKnownSpellSchema,
    creMemorizedSpellSchema,
    creSpellMemInfoSchema,
    type CreEffectV1Data,
    type CreEffectV2Data,
    type CreHeaderData,
    type CreItemData,
    type CreKnownSpellData,
    type CreMemorizedSpellData,
    type CreSpellMemInfoData,
} from "./schemas";
import { serializeCre } from "./serializer";
import { creEffectV1Spec } from "./specs/effect-v1";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";
import {
    CRE_EFFECT_V1_SIZE,
    CRE_EFFECT_V2_SIZE,
    CRE_GROUP_LABELS,
    CRE_HEADER_SIZE,
    CRE_ITEM_SIZE,
    CRE_ITEM_SLOTS_SIZE,
    CRE_ITEM_SLOT_COUNT,
    CRE_ITEM_SLOT_LABELS,
    CRE_KNOWN_SPELL_SIZE,
    CRE_MEMORIZED_SPELL_SIZE,
    CRE_SIGNATURE,
    CRE_SPELL_MEM_INFO_SIZE,
    CRE_VERSION_V1,
} from "./types";

const headerPresentation = {} as const;
const knownSpellPresentation = {} as const;
const spellMemInfoPresentation = {} as const;
const memorizedSpellPresentation = {} as const;
const itemPresentation = {} as const;
const effectV1Presentation = {} as const;
const effectV2Presentation = {} as const;

const FORMAT_ID = "cre";
const FORMAT_NAME = "Infinity Engine CRE v1";

interface SectionExtent {
    readonly label: string;
    readonly offset: number;
    readonly count: number;
    readonly size: number;
}

/**
 * Common bounds check for the five header-driven variable sections. Returns
 * a "fits" decision so the caller can either decode or fail-fast with a
 * useful message. Header counts are u32, so the multiplication cannot
 * overflow JS safe integers given any plausible record size.
 */
function checkSectionFits(section: SectionExtent, fileSize: number): string | undefined {
    const { label, offset, count, size } = section;
    if (count < 0 || !Number.isInteger(count)) {
        return `${label}: invalid count ${count}`;
    }
    const end = offset + count * size;
    if (offset < 0 || end > fileSize) {
        return `${label}: section extends past EOF (offset 0x${offset.toString(16)} + ${count}*0x${size.toString(16)} > size ${fileSize})`;
    }
    return undefined;
}

class CreParser implements BinaryParser {
    readonly id = FORMAT_ID;
    readonly name = FORMAT_NAME;
    readonly extensions = ["cre"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: group(CRE_GROUP_LABELS.file, []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        if (data.byteLength < CRE_HEADER_SIZE) {
            return this.fail(`File too small: ${data.byteLength} bytes, need at least ${CRE_HEADER_SIZE} for header`);
        }
        const signature = [...data.subarray(0, 4)];
        if (!bytesEqual(signature, [...CRE_SIGNATURE])) {
            return this.fail(`Not a CRE file: signature ${JSON.stringify(String.fromCodePoint(...signature))}`);
        }
        const version = [...data.subarray(4, 8)];
        if (!bytesEqual(version, [...CRE_VERSION_V1])) {
            return this.fail(
                `Unsupported CRE version: ${JSON.stringify(String.fromCodePoint(...version))} (only V1.0 is supported)`,
            );
        }

        const header: CreHeaderData = creHeaderSchema.read(readerAt(data, 0));

        if (header.effStructureVersion !== 0 && header.effStructureVersion !== 1) {
            return this.fail(
                `Unsupported effStructureVersion ${header.effStructureVersion} at 0x33 (only 0 or 1 are supported)`,
            );
        }
        const effectsKind: "v1" | "v2" = header.effStructureVersion === 0 ? "v1" : "v2";
        const effectSize = effectsKind === "v1" ? CRE_EFFECT_V1_SIZE : CRE_EFFECT_V2_SIZE;

        const fileSize = data.byteLength;
        const sections: readonly SectionExtent[] = [
            {
                label: "knownSpells",
                offset: header.knownSpellsOffset,
                count: header.knownSpellsCount,
                size: CRE_KNOWN_SPELL_SIZE,
            },
            {
                label: "spellMemInfo",
                offset: header.spellMemInfoOffset,
                count: header.spellMemInfoCount,
                size: CRE_SPELL_MEM_INFO_SIZE,
            },
            {
                label: "memorizedSpells",
                offset: header.memorizedSpellsOffset,
                count: header.memorizedSpellsCount,
                size: CRE_MEMORIZED_SPELL_SIZE,
            },
            { label: "effects", offset: header.effectsOffset, count: header.effectsCount, size: effectSize },
            { label: "items", offset: header.itemsOffset, count: header.itemsCount, size: CRE_ITEM_SIZE },
        ];
        for (const s of sections) {
            const err = checkSectionFits(s, fileSize);
            if (err) return this.fail(err);
        }
        if (header.itemSlotsOffset < 0 || header.itemSlotsOffset + CRE_ITEM_SLOTS_SIZE > fileSize) {
            return this.fail(
                `itemSlots: block extends past EOF (offset 0x${header.itemSlotsOffset.toString(16)} + 0x${CRE_ITEM_SLOTS_SIZE.toString(16)} > size ${fileSize})`,
            );
        }

        const knownSpells: CreKnownSpellData[] = [];
        for (let i = 0; i < header.knownSpellsCount; i++) {
            knownSpells.push(
                creKnownSpellSchema.read(readerAt(data, header.knownSpellsOffset + i * CRE_KNOWN_SPELL_SIZE)),
            );
        }
        const spellMemInfo: CreSpellMemInfoData[] = [];
        for (let i = 0; i < header.spellMemInfoCount; i++) {
            spellMemInfo.push(
                creSpellMemInfoSchema.read(readerAt(data, header.spellMemInfoOffset + i * CRE_SPELL_MEM_INFO_SIZE)),
            );
        }
        const memorizedSpells: CreMemorizedSpellData[] = [];
        for (let i = 0; i < header.memorizedSpellsCount; i++) {
            memorizedSpells.push(
                creMemorizedSpellSchema.read(
                    readerAt(data, header.memorizedSpellsOffset + i * CRE_MEMORIZED_SPELL_SIZE),
                ),
            );
        }
        const items: CreItemData[] = [];
        for (let i = 0; i < header.itemsCount; i++) {
            items.push(creItemSchema.read(readerAt(data, header.itemsOffset + i * CRE_ITEM_SIZE)));
        }

        const effectsRecords: CreEffectV1Data[] | CreEffectV2Data[] =
            effectsKind === "v1"
                ? Array.from({ length: header.effectsCount }, (_, i) =>
                      creEffectV1Schema.read(readerAt(data, header.effectsOffset + i * effectSize)),
                  )
                : Array.from({ length: header.effectsCount }, (_, i) =>
                      creEffectV2Schema.read(readerAt(data, header.effectsOffset + i * effectSize)),
                  );

        // Slot semantics documented at CRE_ITEM_SLOT_LABELS in types.ts.
        const slotsView = new DataView(data.buffer, data.byteOffset + header.itemSlotsOffset, CRE_ITEM_SLOTS_SIZE);
        const itemSlots: number[] = [];
        for (let i = 0; i < CRE_ITEM_SLOT_COUNT; i++) {
            itemSlots.push(slotsView.getInt16(i * 2, true));
        }

        const headerGroup = walkStruct(creHeaderSpecAnnotated, headerPresentation, 0, header, CRE_GROUP_LABELS.header);
        const knownSpellsGroup = group(
            CRE_GROUP_LABELS.knownSpells,
            knownSpells.map((k, i) =>
                walkStruct(
                    creKnownSpellSpecAnnotated,
                    knownSpellPresentation,
                    header.knownSpellsOffset + i * CRE_KNOWN_SPELL_SIZE,
                    k,
                    `Known Spell ${i + 1}`,
                ),
            ),
        );
        const spellMemInfoGroup = group(
            CRE_GROUP_LABELS.spellMemInfo,
            spellMemInfo.map((m, i) =>
                walkStruct(
                    creSpellMemInfoSpecAnnotated,
                    spellMemInfoPresentation,
                    header.spellMemInfoOffset + i * CRE_SPELL_MEM_INFO_SIZE,
                    m,
                    `Entry ${i + 1}`,
                ),
            ),
        );
        const memorizedSpellsGroup = group(
            CRE_GROUP_LABELS.memorizedSpells,
            memorizedSpells.map((m, i) =>
                walkStruct(
                    creMemorizedSpellSpecAnnotated,
                    memorizedSpellPresentation,
                    header.memorizedSpellsOffset + i * CRE_MEMORIZED_SPELL_SIZE,
                    m,
                    `Memorized Spell ${i + 1}`,
                ),
            ),
        );
        const effectsGroup = group(
            CRE_GROUP_LABELS.effects,
            effectsKind === "v1"
                ? (effectsRecords as CreEffectV1Data[]).map((e, i) =>
                      walkStruct(
                          creEffectV1Spec,
                          effectV1Presentation,
                          header.effectsOffset + i * effectSize,
                          e,
                          `Effect ${i + 1}`,
                      ),
                  )
                : (effectsRecords as CreEffectV2Data[]).map((e, i) =>
                      walkStruct(
                          effBodySpecAnnotated,
                          effectV2Presentation,
                          header.effectsOffset + i * effectSize,
                          e,
                          `Effect ${i + 1}`,
                      ),
                  ),
        );
        const itemsGroup = group(
            CRE_GROUP_LABELS.items,
            items.map((it, i) =>
                walkStruct(
                    creItemSpecAnnotated,
                    itemPresentation,
                    header.itemsOffset + i * CRE_ITEM_SIZE,
                    it,
                    `Item ${i + 1}`,
                ),
            ),
        );
        const itemSlotFields: ParsedField[] = itemSlots.map((value, i) => ({
            name: CRE_ITEM_SLOT_LABELS[i] ?? `Slot ${i}`,
            offset: header.itemSlotsOffset + i * 2,
            size: 2,
            type: "int16" as const,
            value,
        }));
        const itemSlotsGroup = group(CRE_GROUP_LABELS.itemSlots, itemSlotFields);

        const document: CreCanonicalDocument =
            effectsKind === "v1"
                ? {
                      header,
                      knownSpells,
                      spellMemInfo,
                      memorizedSpells,
                      effects: { kind: "v1", records: effectsRecords as CreEffectV1Data[] },
                      items,
                      itemSlots,
                  }
                : {
                      header,
                      knownSpells,
                      spellMemInfo,
                      memorizedSpells,
                      effects: { kind: "v2", records: effectsRecords as CreEffectV2Data[] },
                      items,
                      itemSlots,
                  };

        return {
            format: this.id,
            formatName: this.name,
            variantId: "creature",
            root: group(CRE_GROUP_LABELS.file, [
                headerGroup,
                knownSpellsGroup,
                spellMemInfoGroup,
                memorizedSpellsGroup,
                effectsGroup,
                itemsGroup,
                itemSlotsGroup,
            ]),
            document,
        };
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeCre(result);
    }
}

export const creParser = new CreParser();
