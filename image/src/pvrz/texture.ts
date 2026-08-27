/** The two block-compression formats the desktop Infinity Engine ships inside PVRZ. */
export type PvrFormat = "bc1" | "bc3";

/**
 * A decoded PVRZ page. `rgba` is `width * height * 4` bytes.
 *
 * `format` is decode-side provenance - which codec read this page - and nothing more. It is
 * deliberately NOT an encode input: a page is only ever rewritten by a repack, which composes a
 * fresh canvas out of frames drawn from several source pages, so there is no single arrival format
 * to preserve. See encodePvrz, which always writes BC3.
 */
export interface PvrTexture {
    width: number;
    height: number;
    format: PvrFormat;
    rgba: Uint8Array;
}
