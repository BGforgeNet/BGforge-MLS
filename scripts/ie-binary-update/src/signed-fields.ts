/**
 * Fields IESDP types as an unsigned integer that actually hold a signed value.
 *
 * IESDP's type vocabulary has no signed integer: everything 32 bits wide is a `dword`, so `SCALAR_CODEC` maps
 * it to `u32` and a stored -4 surfaces as 4294967292. `strref` is the one case already special-cased there for
 * the same reason (its -1 "no string" sentinel). This table is the general form of that correction, applied at
 * GENERATION so the emitted spec is right for every consumer.
 *
 * Declared here rather than patched into each format's `*.overrides.ts` because the same record is generated
 * into more than one spec - the effect's save bonus lives in both the shared 48-byte feature block and the EFF
 * v2 body - and a per-format patch reaches whichever file its author was looking at. That is exactly how the
 * save bonus stayed unsigned while the EFF body's coordinates beside it were corrected.
 *
 * Keyed `<specConst>.<fieldName>`. `binary/test/signed-field-declarations.test.ts` sweeps every spec for a
 * field IESDP calls a bonus and fails on any left unsigned without a recorded reason, so the next one
 * announces itself instead of waiting to be spotted on screen.
 */

export const SIGNED_FIELDS: Readonly<Record<string, string>> = {
    // A saving-throw PENALTY is a negative bonus, and the corpus is full of them: -2 and -4 across ~2,500
    // records in both installs. Present in both effect records, which must agree - they are one wire format.
    "effectSpec.saveBonus": "A saving throw penalty is stored as a negative bonus",
    "effBodySpec.saveBonus": "A saving throw penalty is stored as a negative bonus",

    // -1 is the engine's "no coordinate", and real map coordinates go negative. IESDP types these `dword` and
    // has no signed type, so the generator would surface -1 as 4294967295.
    "effBodySpec.casterXCoord": "-1 means no coordinate, and map coordinates are signed",
    "effBodySpec.casterYCoord": "-1 means no coordinate, and map coordinates are signed",
    "effBodySpec.targetXCoord": "-1 means no coordinate, and map coordinates are signed",
    "effBodySpec.targetYCoord": "-1 means no coordinate, and map coordinates are signed",

    // A damage PENALTY, the same shape as the save bonus. Word-wide here, so the unsigned reading is 65535.
    "itmAbilitySpec.damageBonus": "A damage penalty is stored as a negative bonus",

    // No negative occurs in either install (2,914 abilities), so the corpus alone cannot settle this one.
    // IESDP does: it documents 32767 as the "always hits" value, which is i16's maximum, and the corpus tops
    // out at exactly that with nothing above - a field the engine reads as a signed word.
    "itmAbilitySpec.thac0Bonus": "THAC0 penalties are negative; IESDP's 32767 sentinel is i16's maximum",
};

/** The signed counterpart of an unsigned codec, for the fields listed above. */
const SIGNED_CODEC: Readonly<Record<string, string>> = { u8: "i8", u16: "i16", u32: "i32" };

/**
 * The codec a field should carry: the signed counterpart where the field is declared signed above, otherwise
 * the codec IESDP's type implies. Throws on a declaration that names a field whose type has no signed form -
 * that means the entry is wrong, and silently emitting the unsigned codec is what this table exists to stop.
 */
export function applySignedness(specConst: string, fieldName: string, codec: string): string {
    const key = `${specConst}.${fieldName}`;
    if (!(key in SIGNED_FIELDS)) return codec;
    const signed = SIGNED_CODEC[codec];
    if (signed === undefined) {
        throw new Error(`${key} is declared signed, but its codec ${codec} has no signed counterpart.`);
    }
    return signed;
}
