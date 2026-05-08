/**
 * Signature help data types and utilities.
 * Provides function signature information for parameter hints while typing.
 */

import { Position, SignatureInformation } from "vscode-languageserver/node";
import { loadStaticMap } from "./static-data";

export interface SigInfoEx extends SignatureInformation {
    uri: string;
}
export interface SigMap extends Map<string, SigInfoEx> {}

export function loadStatic(langId: string): SigMap {
    return loadStaticMap<SigInfoEx>("signature", langId);
}

export function getResponse(signature: SignatureInformation, parameter: number) {
    const result = {
        signatures: [signature],
        activeSignature: 0,
        activeParameter: parameter,
    };
    return result;
}

interface Request {
    symbol: string;
    parameter: number;
}

/** Finds label and current parameter index */
export function getRequest(text: string, position: Position) {
    const lines = text.split(/\r?\n/g);
    const line = lines[position.line];
    if (!line) return;
    const pos = position.character;

    // only left side matters for signature
    const left = line.slice(0, pos);
    const lastChar = left.slice(-1);

    // short circuit on closing parenthesis
    if (lastChar === ")") {
        return;
    }
    const splitOnParen = left.split("(");
    const args = splitOnParen.pop();
    if (!args && args !== "") {
        return;
    }

    // get last element from left side
    let symbol = splitOnParen.at(-1);
    if (!symbol) {
        return;
    }
    // split it again on whitespace
    symbol = symbol.split(" ").at(-1);
    if (!symbol) {
        return;
    }
    const posInArgs = pos - (left.length - args.length);
    // again, right side doesn't matter
    const argsLeft = args.slice(0, posInArgs);
    const argNum = argsLeft.split(",").length - 1;
    const request: Request = { symbol: symbol, parameter: argNum };
    return request;
}
