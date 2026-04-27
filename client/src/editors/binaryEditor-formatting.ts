// Webview bundle is browser-targeted; deep-import the leaf module so esbuild
// can tree-shake to a tiny bundle (the @bgforge/binary barrel pulls zod).
import { type StringCharset, isCharAllowedInCharset } from "../../../binary/src/string-charset";

export type NumericFormat = "decimal" | "hex32";

export type StringFieldCharset = StringCharset;

export function formatNumericValue(rawValue: number, numericFormat: NumericFormat): string {
    if (numericFormat === "hex32") {
        return `0x${(rawValue >>> 0).toString(16).toUpperCase()}`;
    }

    return String(rawValue);
}

export function formatEditableNumberValue(rawValue: number, numericFormat: NumericFormat): string {
    if (numericFormat === "hex32") {
        return (rawValue >>> 0).toString(16).toUpperCase();
    }

    return String(rawValue);
}

/**
 * Live keystroke sanitization for `string` field inputs.
 *
 * Charset semantics come from `@bgforge/binary/string-charset` — the same
 * module the host-side validator imports — so the keystroke filter and the
 * authoritative validator cannot drift apart.
 *
 * Under both charsets the result is clamped to `maxBytes` of UTF-8 storage.
 * The clamp drops trailing codepoints whole rather than splitting a multi-byte
 * sequence: feeding a half-codepoint to the writer would corrupt the on-disk
 * byte.
 *
 * Sanitization is a UI affordance, not a security boundary: the host-side
 * validator still runs on every edit and is authoritative.
 */
export function sanitizeEditableStringValue(text: string, maxBytes: number, charset: StringFieldCharset): string {
    let candidate = text;
    if (charset !== "utf8") {
        let filtered = "";
        for (let i = 0; i < candidate.length; i++) {
            const code = candidate.charCodeAt(i);
            if (isCharAllowedInCharset(code, charset)) {
                filtered += candidate[i];
            }
        }
        candidate = filtered;
    }

    const encoder = new TextEncoder();
    if (encoder.encode(candidate).length <= maxBytes) {
        return candidate;
    }

    // Walk codepoints from the end, dropping one at a time until the byte
    // budget is satisfied. Avoids splitting a surrogate pair or a multi-byte
    // UTF-8 sequence at the boundary.
    const codepoints = [...candidate];
    while (codepoints.length > 0 && encoder.encode(codepoints.join("")).length > maxBytes) {
        codepoints.pop();
    }
    return codepoints.join("");
}

export function sanitizeEditableNumberValue(text: string, numericFormat: NumericFormat): string {
    if (numericFormat === "hex32") {
        return text.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    }

    const trimmed = text.replace(/[^\d-]/g, "");
    if (trimmed.startsWith("-")) {
        return `-${trimmed.slice(1).replace(/-/g, "")}`;
    }
    return trimmed.replace(/-/g, "");
}

export function parseEditableNumberValue(text: string, numericFormat: NumericFormat, valueType?: string): number {
    const sanitized = sanitizeEditableNumberValue(text.trim(), numericFormat);
    if (sanitized.length === 0 || sanitized === "-") {
        return Number.NaN;
    }

    if (numericFormat === "hex32") {
        const parsed = Number.parseInt(sanitized, 16);
        if (!Number.isFinite(parsed)) {
            return Number.NaN;
        }

        if (valueType?.startsWith("int") && parsed >= 0x80_00_00_00) {
            return parsed - 0x1_00_00_00_00;
        }

        return parsed;
    }

    return Number.parseInt(sanitized, 10);
}
