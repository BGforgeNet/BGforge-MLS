/** The two block-compression formats the desktop Infinity Engine ships inside PVRZ. */
export type PvrFormat = "bc1" | "bc3";

/**
 * A decoded PVRZ page. `rgba` is `width * height * 4` bytes; `format` is retained because a page
 * rewritten on save re-encodes in the format it arrived in rather than being silently promoted.
 */
export interface PvrTexture {
    width: number;
    height: number;
    format: PvrFormat;
    rgba: Uint8Array;
}
