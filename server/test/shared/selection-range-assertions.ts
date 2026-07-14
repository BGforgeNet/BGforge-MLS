/**
 * Shared assertion helpers for selection-range tests. Used by the shared
 * factory unit tests and by each language provider's real-parser test.
 */

import { expect } from "vitest";
import type { Position, SelectionRange } from "vscode-languageserver/node";

/** Walk a SelectionRange chain (innermost first) into a flat array via .parent links. */
export function chainToArray(range: SelectionRange): SelectionRange[] {
    const result: SelectionRange[] = [];
    let current: SelectionRange | undefined = range;
    while (current) {
        result.push(current);
        current = current.parent;
    }
    return result;
}

/** True when `outer` fully contains `inner` (LSP Range, line/character positions). */
export function rangeContains(outer: SelectionRange["range"], inner: SelectionRange["range"]): boolean {
    const startsBefore =
        outer.start.line < inner.start.line ||
        (outer.start.line === inner.start.line && outer.start.character <= inner.start.character);
    const endsAfter =
        outer.end.line > inner.end.line ||
        (outer.end.line === inner.end.line && outer.end.character >= inner.end.character);
    return startsBefore && endsAfter;
}

function rangesEqual(a: SelectionRange["range"], b: SelectionRange["range"]): boolean {
    return (
        a.start.line === b.start.line &&
        a.start.character === b.start.character &&
        a.end.line === b.end.line &&
        a.end.character === b.end.character
    );
}

/**
 * Assert a SelectionRange chain is well-formed: every link contains the requested
 * position, and each successive (outer) link strictly widens on its predecessor -
 * consecutive duplicate ranges would make VS Code's Expand Selection appear stuck.
 * Returns the flattened chain (innermost first) for further assertions.
 */
export function expectWellFormedChain(range: SelectionRange, position: Position): SelectionRange[] {
    const chain = chainToArray(range);
    for (const r of chain) {
        expect(rangeContains(r.range, { start: position, end: position })).toBe(true);
    }
    for (let i = 1; i < chain.length; i++) {
        expect(rangeContains(chain[i]!.range, chain[i - 1]!.range)).toBe(true);
        expect(rangesEqual(chain[i]!.range, chain[i - 1]!.range)).toBe(false);
    }
    return chain;
}
