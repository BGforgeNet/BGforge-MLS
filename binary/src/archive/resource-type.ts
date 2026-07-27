/**
 * Infinity Engine resource-type codes <-> file extensions, transcribed from IESDP
 * file_formats/general.htm (the numeric `resType` column). Text formats with an
 * N/A code (.mus/.sav/.res/.baf/.var) are omitted - they never carry a KEY resType.
 */

/** TIS (tileset) resType. A TIS resource is located via the KEY tileset index, not the file index. */
export const RESOURCE_TYPE_TIS = 0x03eb;

const CODE_TO_EXT: Readonly<Record<number, string>> = {
    0x0001: "bmp",
    0x0002: "mve",
    0x0004: "wav",
    0x0005: "wfx",
    0x0006: "plt",
    0x03e8: "bam",
    0x03e9: "wed",
    0x03ea: "chu",
    0x03eb: "tis",
    0x03ec: "mos",
    0x03ed: "itm",
    0x03ee: "spl",
    0x03ef: "bcs",
    0x03f0: "ids",
    0x03f1: "cre",
    0x03f2: "are",
    0x03f3: "dlg",
    0x03f4: "2da",
    0x03f5: "gam",
    0x03f6: "sto",
    0x03f7: "wmp",
    0x03f8: "eff",
    0x03f9: "bs",
    0x03fa: "chr",
    0x03fb: "vvc",
    0x03fc: "vef",
    0x03fd: "pro",
    0x03fe: "bio",
    0x03ff: "wbm",
    0x0400: "fnt",
    0x0402: "gui",
    0x0403: "sql",
    0x0404: "pvrz",
    0x0405: "glsl",
    0x0406: "tot",
    0x0407: "toh",
    0x0408: "menu",
    0x0409: "lua",
    0x040a: "ttf",
    0x040b: "png",
    0x044c: "bah",
    0x0802: "ini",
    0x0803: "src",
    0x0804: "maze",
};

const EXT_TO_CODE: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(CODE_TO_EXT).map(([code, ext]) => [ext, Number(code)]),
);

/** Lowercase extension for a resType, or undefined if the code is unknown. */
export function resourceTypeExt(code: number): string | undefined {
    return CODE_TO_EXT[code];
}

/** resType for an extension (leading dot and case ignored), or undefined if unknown. */
export function resourceTypeCode(ext: string): number | undefined {
    return EXT_TO_CODE[ext.replace(/^\./, "").toLowerCase()];
}
