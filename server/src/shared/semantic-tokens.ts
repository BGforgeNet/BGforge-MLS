import {
    type SemanticTokensLegend,
    SemanticTokenTypes,
    SemanticTokens,
    SemanticTokensBuilder,
} from "vscode-languageserver/node";

export interface SemanticTokenSpan {
    readonly line: number;
    readonly startChar: number;
    readonly length: number;
    readonly tokenType: string;
    readonly tokenModifiers: number;
}

/** Custom semantic token type for resref-typed variables (resource references like spell/item filenames). */
export const RESREF_TOKEN_TYPE = "resref";

/** Custom semantic token type for byte-typed IESDP constants. */
export const BYTE_TOKEN_TYPE = "byte";

/** Custom semantic token type for char-typed IESDP constants. */
export const CHAR_TOKEN_TYPE = "char";

/** Custom semantic token type for dword-typed IESDP constants. */
export const DWORD_TOKEN_TYPE = "dword";

/**
 * Semantic token type for int-typed constants (inferred from assignments like SET X = 42).
 * Provides highlighting for single-word UPPER_CASE constants that don't match
 * the TextMate catch-all regex (which requires an underscore).
 */
export const INT_TOKEN_TYPE = "int";

/**
 * Semantic token types for 2DA table cells, one per column slot (cycling mod 6).
 * Each column index maps to `CELL_2DA_COL_TYPES[colIndex % 6]`, giving six distinct
 * colors that repeat across wider tables.
 */
export const CELL_2DA_C0 = "2da-c0" as const;
export const CELL_2DA_C1 = "2da-c1" as const;
const CELL_2DA_C2 = "2da-c2" as const;
const CELL_2DA_C3 = "2da-c3" as const;
const CELL_2DA_C4 = "2da-c4" as const;
const CELL_2DA_C5 = "2da-c5" as const;

export const CELL_2DA_COL_TYPES = [
    CELL_2DA_C0,
    CELL_2DA_C1,
    CELL_2DA_C2,
    CELL_2DA_C3,
    CELL_2DA_C4,
    CELL_2DA_C5,
] as const;

/**
 * Maps JSDoc @type prefixes to custom semantic token types.
 * Used to look up which token type to assign to a constant based on its annotated type.
 * IESDP types have distinct theme styling (byte/char=italic, dword=bold, resref=underline).
 * Int type provides constant highlighting for user-defined single-word UPPER constants.
 * Types without special styling (word, strref, other) rely on the generic upper-case-constants TextMate rule.
 */
export const JSDOC_TYPE_TO_TOKEN: ReadonlyMap<string, string> = new Map([
    ["resref", RESREF_TOKEN_TYPE],
    ["byte", BYTE_TOKEN_TYPE],
    ["char", CHAR_TOKEN_TYPE],
    ["dword", DWORD_TOKEN_TYPE],
    ["int", INT_TOKEN_TYPE],
]);

export const semanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [
        SemanticTokenTypes.parameter,
        SemanticTokenTypes.variable,
        RESREF_TOKEN_TYPE,
        BYTE_TOKEN_TYPE,
        CHAR_TOKEN_TYPE,
        DWORD_TOKEN_TYPE,
        INT_TOKEN_TYPE,
        CELL_2DA_C0,
        CELL_2DA_C1,
        CELL_2DA_C2,
        CELL_2DA_C3,
        CELL_2DA_C4,
        CELL_2DA_C5,
    ],
    tokenModifiers: [],
};

const tokenTypeToIndex = new Map(
    semanticTokensLegend.tokenTypes.map((tokenType, index) => [tokenType, index] as const),
);

function compareSpans(left: SemanticTokenSpan, right: SemanticTokenSpan): number {
    if (left.line !== right.line) {
        return left.line - right.line;
    }
    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }
    if (left.length !== right.length) {
        return left.length - right.length;
    }
    return left.tokenType.localeCompare(right.tokenType);
}

export function encodeSemanticTokens(spans: readonly SemanticTokenSpan[]): SemanticTokens {
    if (spans.length === 0) {
        return { data: [] };
    }

    const builder = new SemanticTokensBuilder();
    const sorted = [...spans].sort(compareSpans);

    for (const span of sorted) {
        const tokenTypeIndex = tokenTypeToIndex.get(span.tokenType);
        if (tokenTypeIndex === undefined || span.length <= 0) {
            continue;
        }
        builder.push(span.line, span.startChar, span.length, tokenTypeIndex, span.tokenModifiers);
    }

    const built = builder.build();
    return { data: built.data };
}
