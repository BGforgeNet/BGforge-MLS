/**
 * BAF Intermediate Representation
 *
 * Structured types representing BAF semantics, not strings.
 * Used between the AST transformer and the BAF emitter.
 */

/** A single condition check like See(Player1) or !Global("x", "LOCALS", 0) */
export interface BAFCondition {
    negated: boolean;
    name: string; // "See", "Global", "LevelLT", etc.
    args: string[]; // ["Player1"], ["\"x\"", "\"LOCALS\"", "0"]
    /** 0-based line of the bundled source this came from, where one is known. See BAFBlock.line. */
    line?: number;
}

/** OR group: (a || b || c) - emits as OR(n) followed by conditions */
export interface BAFOrGroup {
    conditions: BAFCondition[];
}

/** Top-level condition: either a single condition or an OR group */
export type BAFTopCondition = BAFCondition | BAFOrGroup;

/** An action like Spell(Myself, WIZARD_SHIELD) */
export interface BAFAction {
    name: string;
    args: string[];
    comment?: string; // Optional inline comment
    /** 0-based line of the bundled source this came from, where one is known. See BAFBlock.line. */
    line?: number;
}

/** A complete IF/THEN/END block */
export interface BAFBlock {
    conditions: BAFTopCondition[]; // ANDed together
    actions: BAFAction[];
    response: number; // Usually 100
    /**
     * 0-based line of the bundled source this block was built from, where one is known. Carried so a
     * diagnostic the BAF compiler reports can be traced back past the emitter, which is the last place
     * that still knows the correspondence. Absent for a block with no single statement behind it.
     */
    line?: number;
}

/** Complete BAF script */
export interface BAFScript {
    sourceFile: string; // For header comment
    traTag?: string;
    blocks: BAFBlock[];
}

/** Type guard: check if a condition is an OR group */
export function isOrGroup(cond: BAFTopCondition): cond is BAFOrGroup {
    return "conditions" in cond;
}
