/**
 * Cursor-position-driven token extraction. Used by LSP handlers (hover,
 * definition) to figure out what word, translation reference, or message-line
 * reference is under the cursor.
 */

import type { Position } from "vscode-languageserver/node";
import { REGEX_MSG_INLAY, REGEX_MSG_INLAY_FLOATER_RAND } from "./core/patterns";

/** Extract the text from the start of the line up to the cursor position. */
export function getLinePrefix(text: string, position: Position): string {
    return text.split("\n")[position.line]?.substring(0, position.character) ?? "";
}

/**
 * Get word under cursor, for which we want to find a hover
 * This a preliminary non-whitespace symbol, could look like `NOption(154,Node003,004`
 * or `NOption(154` or `NOption`
 * From that hover will extract the actual symbol or tra reference to search for.
 */
export function symbolAtPosition(text: string, position: Position) {
    const lines = text.split(/\r?\n/g);
    const str = lines[position.line];
    if (!str) {
        return "";
    }
    const pos = position.character;

    // Check if cursor is within a tra(123) pattern (TBAF/TD translation reference)
    const traMatch = findTraArgumentAtPosition(str, pos);
    if (traMatch) {
        return traMatch;
    }

    const msgMatch = findMsgArgumentAtPosition(str, pos);
    if (msgMatch) {
        return msgMatch;
    }

    // Search for the word's beginning and end.
    let left = str.slice(0, pos + 1).search(/\w+$/),
        right = str.slice(pos).search(/\W/);

    let result: string;
    // The last word in the string is a special case.
    if (right < 0) {
        result = str.slice(left);
    } else {
        // Return the word, using the located bounds to extract it from the string.
        result = str.slice(left, right + pos);
    }

    // if a proper symbol, return
    if (!onlyDigits(result)) {
        return result;
    }

    // and if pure numeric, check if it's a tra reference
    // Use [^\s(] instead of \S to treat ( as a boundary - prevents matching
    // through nested calls like display_msg(mstr(101)) where \S+ would grab
    // the entire "display_msg(mstr(101" and fail to match REGEX_MSG_HOVER.
    if (onlyDigits(result)) {
        left = str.slice(0, pos + 1).search(/[^\s(]+\(?\d+$/);
        right = str.slice(pos).search(/\W/);
        if (right < 0) {
            result = str.slice(left);
        } else {
            result = str.slice(left, right + pos);
        }
    }

    return result;
}

/**
 * Find if cursor is within a transpiler tra(123) translation reference.
 * Used by both TBAF and TD files (same syntax).
 * Word boundary prevents matching inside words like "extra(100)".
 * Matches when cursor is anywhere within the tra(digits) span.
 */
function findTraArgumentAtPosition(line: string, pos: number): string | null {
    const pattern = /\btra\((\d+)\)/g;
    for (const match of line.matchAll(pattern)) {
        if (!match[1]) continue;
        const matchEnd = match.index + match[0].length;
        if (pos >= match.index && pos < matchEnd) {
            return match[0];
        }
    }
    return null;
}

/**
 * Find if cursor is within a Fallout MSG reference.
 * Returns the normalized hover token form, e.g. "mstr(100" or "floater_rand(307".
 */
function findMsgArgumentAtPosition(line: string, pos: number): string | null {
    for (const match of line.matchAll(REGEX_MSG_INLAY)) {
        const functionName = match[1];
        const lineKey = match[2];
        if (!functionName || !lineKey) {
            continue;
        }
        const start = match.index + match[0].lastIndexOf(lineKey);
        const end = start + lineKey.length;
        if (pos >= start && pos < end) {
            return `${functionName}(${lineKey}`;
        }
    }

    for (const match of line.matchAll(REGEX_MSG_INLAY_FLOATER_RAND)) {
        const firstKey = match[1];
        const secondKey = match[2];
        if (!firstKey || !secondKey) {
            continue;
        }
        const firstStart = match.index + match[0].indexOf(firstKey);
        const firstEnd = firstStart + firstKey.length;
        if (pos >= firstStart && pos < firstEnd) {
            return `floater_rand(${firstKey}`;
        }

        const secondStart = match.index + match[0].lastIndexOf(secondKey);
        const secondEnd = secondStart + secondKey.length;
        if (pos >= secondStart && pos < secondEnd) {
            return `floater_rand(${secondKey}`;
        }
    }

    return null;
}

function onlyDigits(value: string) {
    return /^\d+$/.test(value);
}
