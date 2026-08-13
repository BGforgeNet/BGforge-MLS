/**
 * Dead-code elimination over the IR, matching what the reference compiler removes at `-O1`: procedures
 * nothing can reach, and globals nothing reads. It runs between lowering and emission, so the emitter
 * needs no knowledge of it and unoptimised output stays byte-identical to before.
 *
 * Both passes are REMOVALS, and a removal that is wrong produces a script the engine loads and then
 * misbehaves on, with no diagnostic anywhere. So each is conservative by construction: anything whose
 * reachability cannot be decided keeps everything it might have reached, and the whole procedure pass
 * bails out when the script can name a procedure the analysis cannot see.
 *
 * Level 2 goes further - constant folding, dead stores, unreachable statements, constant globals - but is
 * not finished; see `OptimizeOptions.level`. Its rules are taken from the reference compiler's own
 * `optimize.c` rather than inferred from its output: three folds guessed from byte diffs turned out to be
 * wrong, one of them deleting branches the reference keeps, and reading the source settled each in a line.
 */

import {
    alwaysReturns,
    globalsOf,
    proceduresOf,
    type BinaryOp,
    type Declaration,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
    type VariableDecl,
} from "./int/ir";

export interface OptimizeOptions {
    /**
     * 0 leaves the program untouched. 1 removes unreachable procedures and unreferenced variables, and
     * is byte-identical to the reference compiler's own `-O1` across the corpus.
     *
     * 2 is not reachable from the extension yet. Every pass the reference runs is ported here from its
     * `optimize.c` - constant folding, dead stores, dead code, assignment combining, dead variables -
     * under the same two nested fixpoints, and it reproduces the reference byte for byte on about 93% of
     * the corpus. The rest is a long tail of small classes; the largest is an `if` whose `else` this
     * leaves in place as an empty arm, so the emitter writes a jump over nothing.
     */
    level?: 0 | 1 | 2;
}

/**
 * Whether an expression can be dropped without losing anything but its value. A call of either kind can
 * do arbitrary work, so a store fed by one stays even when the variable it writes is dead - which is
 * what the reference does too.
 */
function isPure(expr: Expr): boolean {
    switch (expr.kind) {
        case "call":
        case "libCall":
            return false;
        case "unary":
            return isPure(expr.operand);
        case "binary":
            return isPure(expr.left) && isPure(expr.right);
        case "ternary":
            return isPure(expr.cond) && isPure(expr.whenTrue) && isPure(expr.whenFalse);
        default:
            return true;
    }
}

/**
 * Evaluates what is already known. Applied bottom-up, so nested constants collapse in one pass.
 *
 * Only the folds the reference performs belong here: folding MORE is as much a mismatch as folding less,
 * and an arithmetic identity that holds in TypeScript need not hold for the engine's own semantics.
 */
function foldConstants(expr: Expr): Expr {
    if (expr.kind === "unary") {
        const operand = expr.operand;
        if (operand.kind !== "int" && operand.kind !== "float") return expr;
        switch (expr.op) {
            case "not":
                return { kind: "int", value: operand.value === 0 ? 1 : 0 };
            case "bwnot":
                return { kind: "int", value: ~operand.value };
            case "negate":
                return { ...operand, value: -operand.value };
            default:
                // `floor` is not in the reference's unary fold set.
                return expr;
        }
    }
    if (expr.kind !== "binary") return expr;
    const left = expr.left;
    const right = expr.right;
    if ((left.kind !== "int" && left.kind !== "float") || (right.kind !== "int" && right.kind !== "float")) return expr;

    const int = (value: number): Expr => ({ kind: "int", value });
    const bool = (value: boolean): Expr => int(value ? 1 : 0);
    // A float operand makes an ARITHMETIC result float; comparisons, logicals and bitwise stay integer.
    // The arithmetic is done in 32-bit, which is the width the engine and the reference both use.
    const isFloat = left.kind === "float" || right.kind === "float";
    const a = left.value;
    const b = right.value;
    const arith = (value: number): Expr => (isFloat ? { kind: "float", value: Math.fround(value) } : int(value));

    switch (expr.op) {
        case "+":
            return arith(a + b);
        case "-":
            return arith(a - b);
        case "*":
            return arith(a * b);
        case "/":
        case "div":
            if (b === 0) return expr; // Left for the engine rather than decided here.
            return isFloat ? arith(a / b) : int(Math.trunc(a / b));
        // `and`/`or` are listed in the reference's fold set but never reach it: its own comment in
        // `ConstantFolding` records that they "were changed in the tree", so by the time folding runs
        // they are no longer plain binary nodes. Folding them here decides branches it keeps.
        case "bwand":
            return int(a & b);
        case "bwor":
            return int(a | b);
        case "bwxor":
            return int(a ^ b);
        case "==":
            return bool(a === b);
        case "!=":
            return bool(a !== b);
        case "<":
            return bool(a < b);
        case ">":
            return bool(a > b);
        case "<=":
            return bool(a <= b);
        case ">=":
            return bool(a >= b);
        default:
            // `%`, `^`, and the short-circuiting `andalso`/`orelse` are absent from the reference's
            // fold set. Folding them was worth 49 scripts' worth of mismatch before this was checked.
            return expr;
    }
}

/** A condition whose value is known at compile time, or null when it has to be evaluated. */
function constantTruth(expr: Expr): boolean | null {
    if (expr.kind === "int" || expr.kind === "float") return expr.value !== 0;
    return null;
}

/**
 * Procedures the ENGINE calls by name, so nothing in the script needs to reference them. A name missing
 * here is a procedure that gets deleted out of a working script, and no differential against a Fallout 2
 * corpus can reveal the omission of a Fallout 1 name - so this follows the reference compiler's own
 * protected list rather than the engine dispatch table, which covers one game only.
 *
 * `no_p_proc` and `none_x_bad` are placeholders in the engine's table. They are kept as roots regardless:
 * a script defining one is doing something strange, and preserving it costs a few bytes where removing it
 * could break something nothing else records.
 */
const ENGINE_ENTRY_POINTS: ReadonlySet<string> = new Set([
    "no_p_proc",
    "start",
    "spatial_p_proc",
    "description_p_proc",
    // Fallout 1 spells it this way, and a Fallout 1 script is still something this compiler accepts.
    "desc_p_proc",
    "pickup_p_proc",
    "drop_p_proc",
    "use_p_proc",
    "use_obj_on_p_proc",
    "use_skill_on_p_proc",
    "none_x_bad",
    "talk_p_proc",
    "critter_p_proc",
    "combat_p_proc",
    "damage_p_proc",
    "map_enter_p_proc",
    "map_exit_p_proc",
    "create_p_proc",
    "destroy_p_proc",
    "look_at_p_proc",
    "timed_event_p_proc",
    "map_update_p_proc",
    "push_p_proc",
    "is_dropping_p_proc",
    "combat_is_starting_p_proc",
    "combat_is_over_p_proc",
]);

/** Every expression in a statement, including the ones nested inside other expressions. */
function forEachExpr(statement: Stmt, visit: (expr: Expr) => void): void {
    const expression = (expr: Expr): void => {
        visit(expr);
        switch (expr.kind) {
            case "unary":
                expression(expr.operand);
                break;
            case "binary":
                expression(expr.left);
                expression(expr.right);
                break;
            case "ternary":
                expression(expr.cond);
                expression(expr.whenTrue);
                expression(expr.whenFalse);
                break;
            case "call":
                expression(expr.target);
                expr.args.forEach(expression);
                break;
            case "libCall":
                expr.args.forEach(expression);
                break;
            default:
                break;
        }
    };

    const walk = (stmt: Stmt): void => {
        switch (stmt.kind) {
            case "block":
                stmt.body.forEach(walk);
                break;
            case "expr":
                expression(stmt.expr);
                break;
            case "assign":
                expression(stmt.target);
                expression(stmt.value);
                break;
            case "if":
                expression(stmt.cond);
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
                break;
            case "while":
                expression(stmt.cond);
                walk(stmt.body);
                break;
            case "return":
                if (stmt.value) expression(stmt.value);
                break;
            case "callStmt":
                expression(stmt.target);
                stmt.args.forEach(expression);
                break;
            case "timedCallStmt":
                expression(stmt.target);
                expression(stmt.delay);
                break;
            case "libStmt":
                stmt.args.forEach(expression);
                break;
            default:
                break;
        }
    };
    walk(statement);
}

/** Every expression a procedure evaluates, its guard included - the guard is code the engine runs. */
function forEachExprInProcedure(procedure: ProcedureDecl, visit: (expr: Expr) => void): void {
    procedure.body.forEach((statement) => forEachExpr(statement, visit));
    if (procedure.conditional) forEachExpr({ kind: "expr", expr: procedure.conditional }, visit);
}

/**
 * Whether any call target is a value rather than a known procedure. The engine's `lookup_string_proc`
 * resolves a procedure from a string computed at runtime, so once a script can do that, no procedure can
 * be shown unreachable and the pass must keep them all.
 */
function hasDynamicProcedureLookup(program: Program): boolean {
    let dynamic = false;
    // A slot and a literal string each name one procedure outright. A VARIABLE target is safe too, and
    // this is the common `stored_node := Node998; call stored_node;` dispatch: the procedure had to be
    // named to get into the variable, so the assignment carries the reference the walk below collects.
    // What cannot be followed is a target COMPUTED at runtime - a concatenated name, a call's result -
    // which `lookup_string_proc` will happily resolve against a procedure nothing here mentions.
    const check = (target: Expr): void => {
        if (target.kind !== "procRef" && target.kind !== "string" && target.kind !== "var") dynamic = true;
    };
    for (const procedure of proceduresOf(program)) {
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "call") check(expr.target);
        });
        const statements = (stmt: Stmt): void => {
            switch (stmt.kind) {
                case "callStmt":
                    check(stmt.target);
                    break;
                case "block":
                    stmt.body.forEach(statements);
                    break;
                case "if":
                    statements(stmt.thenBranch);
                    if (stmt.elseBranch) statements(stmt.elseBranch);
                    break;
                case "while":
                    statements(stmt.body);
                    break;
                default:
                    break;
            }
        };
        procedure.body.forEach(statements);
    }
    return dynamic;
}

/** Indices of procedures reachable from the engine's entry points and from each other. */
function reachableProcedures(program: Program): Set<number> {
    const procedures = proceduresOf(program);
    const byName = new Map<string, number>();
    procedures.forEach((procedure, index) => byName.set(procedure.name.toLowerCase(), index));

    const reachable = new Set<number>();
    const queue: number[] = [];
    const enter = (index: number): void => {
        if (index < 0 || index >= procedures.length || reachable.has(index)) return;
        reachable.add(index);
        queue.push(index);
    };

    procedures.forEach((procedure, index) => {
        // An engine entry point, an export and an import are all reached from outside the script; a
        // timed or guarded procedure is scheduled by the engine off its table entry alone.
        if (
            ENGINE_ENTRY_POINTS.has(procedure.name.toLowerCase()) ||
            procedure.exported ||
            procedure.imported ||
            procedure.timed !== undefined ||
            procedure.conditional
        ) {
            enter(index);
        }
    });

    while (queue.length > 0) {
        const current = procedures[queue.pop() as number];
        if (!current) continue;
        forEachExprInProcedure(current, (expr) => {
            if (expr.kind === "procRef") enter(expr.index);
            // A call through a literal name resolves by string at load time, so it is a real reference.
            if (expr.kind === "string") {
                const named = byName.get(expr.value.toLowerCase());
                if (named !== undefined) enter(named);
            }
        });
    }
    return reachable;
}

/** Rewrites every `procRef` index and global slot through the supplied maps. */
function remap(statement: Stmt, procedures: ReadonlyMap<number, number>, globals: ReadonlyMap<number, number>): Stmt {
    return remapWith(statement, (expr) => {
        if (expr.kind === "procRef") return { ...expr, index: procedures.get(expr.index) ?? expr.index };
        if (expr.kind === "var" && expr.scope === "global") {
            return { ...expr, index: globals.get(expr.index) ?? expr.index };
        }
        return expr;
    });
}

/** Applies a leaf rewrite to every expression in a statement, rebuilding the tree around it. */
function remapWith(statement: Stmt, leaf: (expr: Expr) => Expr): Stmt {
    const expression = (expr: Expr): Expr => {
        switch (expr.kind) {
            case "unary":
                return leaf({ ...expr, operand: expression(expr.operand) });
            case "binary":
                return leaf({ ...expr, left: expression(expr.left), right: expression(expr.right) });
            case "ternary":
                return leaf({
                    ...expr,
                    cond: expression(expr.cond),
                    whenTrue: expression(expr.whenTrue),
                    whenFalse: expression(expr.whenFalse),
                });
            case "call":
                return leaf({ ...expr, target: expression(expr.target), args: expr.args.map(expression) });
            case "libCall":
                return leaf({ ...expr, args: expr.args.map(expression) });
            default:
                return leaf(expr);
        }
    };

    const walk = (stmt: Stmt): Stmt => {
        switch (stmt.kind) {
            case "block":
                return { ...stmt, body: stmt.body.map(walk) };
            case "expr":
                return { ...stmt, expr: expression(stmt.expr) };
            case "assign":
                return {
                    ...stmt,
                    target: expression(stmt.target) as Extract<Expr, { kind: "var" }>,
                    value: expression(stmt.value),
                };
            case "if":
                return {
                    ...stmt,
                    cond: expression(stmt.cond),
                    thenBranch: walk(stmt.thenBranch),
                    ...(stmt.elseBranch ? { elseBranch: walk(stmt.elseBranch) } : {}),
                };
            case "while":
                return { ...stmt, cond: expression(stmt.cond), body: walk(stmt.body) };
            case "return":
                return stmt.value ? { ...stmt, value: expression(stmt.value) } : stmt;
            case "callStmt":
                return { ...stmt, target: expression(stmt.target), args: stmt.args.map(expression) };
            case "timedCallStmt":
                return {
                    ...stmt,
                    target: expression(stmt.target) as Extract<Expr, { kind: "procRef" }>,
                    delay: expression(stmt.delay),
                };
            case "libStmt":
                return { ...stmt, args: stmt.args.map(expression) };
            default:
                return stmt;
        }
    };
    return walk(statement);
}

function rewriteProcedure(
    procedure: ProcedureDecl,
    procedures: ReadonlyMap<number, number>,
    globals: ReadonlyMap<number, number>,
): ProcedureDecl {
    const rewritten: ProcedureDecl = { ...procedure, body: procedure.body.map((s) => remap(s, procedures, globals)) };
    if (procedure.conditional) {
        const guard = remap({ kind: "expr", expr: procedure.conditional }, procedures, globals);
        if (guard.kind === "expr") rewritten.conditional = guard.expr;
    }
    return rewritten;
}

/**
 * Folds conditions whose value is known and drops what that makes unreachable. A `while` whose condition
 * is constantly false disappears; one that is constantly true is left alone, since it still runs.
 */
function foldStatements(statements: Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    for (const statement of statements) {
        const folded = foldStatement(statement);
        if (folded === null) continue;
        out.push(folded);
        // Everything after a statement that always returns is unreachable.
        if (alwaysReturns(folded)) break;
    }
    return out;
}

/**
 * Whether a statement contributes no instructions. Structural emptiness is not enough: a `loopEnd` is a
 * marker the emitter writes nothing for, so a branch holding only those still makes the emitter jump
 * over an arm that is not there.
 */
function emitsNothing(statement: Stmt): boolean {
    switch (statement.kind) {
        case "block":
            return statement.body.every(emitsNothing);
        case "loopEnd":
            return true;
        default:
            return false;
    }
}

function foldStatement(statement: Stmt): Stmt | null {
    switch (statement.kind) {
        case "block": {
            const body = foldStatements(statement.body);
            return body.length > 0 ? { ...statement, body } : null;
        }
        case "if": {
            const taken = constantTruth(statement.cond);
            if (taken === true) return foldStatement(statement.thenBranch);
            if (taken === false) return statement.elseBranch ? foldStatement(statement.elseBranch) : null;
            const thenBranch = foldStatement(statement.thenBranch) ?? { kind: "block" as const, body: [] };
            // An `else` left with nothing in it goes; the reference drops the empty block outright.
            const folded = statement.elseBranch ? foldStatement(statement.elseBranch) : undefined;
            const elseBranch = folded && !emitsNothing(folded) ? folded : undefined;
            // A `then` left with nothing in it and no `else` takes the whole statement with it - but only
            // when the condition can be dropped too. An impure condition still has to be evaluated.
            if (emitsNothing(thenBranch) && !elseBranch) {
                return isPure(statement.cond) ? null : { ...statement, thenBranch, elseBranch: undefined };
            }
            return { ...statement, thenBranch, ...(elseBranch ? { elseBranch } : {}) };
        }
        case "while": {
            if (constantTruth(statement.cond) === false) return null;
            const body = foldStatement(statement.body) ?? { kind: "block" as const, body: [] };
            return { ...statement, body };
        }
        default:
            return statement;
    }
}

/**
 * What one local is used for, in statement order. This mirrors the reference's own bookkeeping rather
 * than computing general liveness: its dead-store rule looks only at a variable's FIRST and LAST
 * assignment, so a faithful port has to record the same four positions and the same flags.
 *
 * Positions are ordinals of the enclosing statement. A statement inside a `while` does not get its own
 * ordinal - the whole loop counts as one - which is what lets the reference treat a store in a loop
 * differently from one in straight-line code.
 */
interface VarUsage {
    firstAssign: Stmt | null;
    lastAssign: Stmt | null;
    firstAssignAt: number;
    lastAssignAt: number;
    firstUseAt: number;
    lastUseAt: number;
    firstAssignPure: boolean;
    firstAssignDead: boolean;
    /** The first store is a lone constant, so its value can move into the variable's declaration. */
    transferable: Expr | null;
    lastAssignPure: boolean;
    lastAssignInWhile: boolean;
    /** The statement directly introduces the store as a branch or loop body, which blocks removal. */
    lastAssignIsBranchBody: boolean;
}

function newUsage(): VarUsage {
    return {
        firstAssign: null,
        lastAssign: null,
        firstAssignAt: 0,
        lastAssignAt: 0,
        firstUseAt: 0,
        lastUseAt: 0,
        firstAssignPure: false,
        firstAssignDead: false,
        transferable: null,
        lastAssignPure: false,
        lastAssignInWhile: false,
        lastAssignIsBranchBody: false,
    };
}

/** Statement-ordered usage for every local, following the reference's traversal exactly. */
function analyzeVarUsage(procedure: ProcedureDecl): Map<number, VarUsage> {
    const usage = new Map<number, VarUsage>();
    const of = (slot: number): VarUsage => {
        let entry = usage.get(slot);
        if (!entry) {
            entry = newUsage();
            usage.set(slot, entry);
        }
        return entry;
    };
    // Statement ordinals, mirroring the reference's node indices: every statement takes one, and
    // ordinal 0 therefore means "never seen". Only a `while` stops its contents taking their own.
    let ordinal = 0;
    const branchBodies = new Set<Stmt>();

    const markRead = (slot: number, at: number): void => {
        const entry = of(slot);
        entry.lastUseAt = at;
        if (entry.firstUseAt === 0) entry.firstUseAt = at;
    };
    const readExpr = (expr: Expr, at: number): void => {
        forEachExpr({ kind: "expr", expr }, (e) => {
            if (e.kind === "var" && e.scope === "local") markRead(e.index, at);
        });
    };

    /**
     * `statement` has just been entered. `whileDepth`/`ifDepth` describe where it sits, and `inherited`
     * is the enclosing statement's position, which only a statement inside a loop keeps: everywhere else
     * - a branch arm included - a statement becomes its own reference point, exactly as the reference's
     * `currstatement` does.
     */
    const walk = (
        statement: Stmt,
        whileDepth: number,
        ifDepth: number,
        inherited: { at: number; stmt: Stmt },
    ): void => {
        ordinal++;
        let nextIf = ifDepth === 0 ? 0 : ifDepth + 1;
        let nextWhile = whileDepth;
        let current = inherited;
        if (whileDepth === 0) {
            current = { at: ordinal, stmt: statement };
            if (statement.kind === "while") nextWhile = 1;
            else if (statement.kind === "if" && ifDepth === 0) nextIf = 1;
        } else {
            nextWhile = whileDepth + 1;
        }
        const at = current.at;

        switch (statement.kind) {
            case "assign": {
                if (statement.target.scope !== "local") {
                    readExpr(statement.value, at);
                    return;
                }
                const slot = statement.target.index;
                const entry = of(slot);
                const pure = isPure(statement.value);
                entry.lastAssign = current.stmt;
                entry.lastAssignAt = at;
                entry.lastAssignPure ||= pure;
                entry.lastAssignInWhile = nextWhile > 0;
                entry.lastAssignIsBranchBody = branchBodies.has(current.stmt);
                if (entry.firstUseAt === 0) {
                    if (entry.firstAssign === null) {
                        entry.firstAssign = current.stmt;
                        entry.firstAssignAt = at;
                        if (pure) {
                            entry.firstAssignPure = true;
                            const value = statement.value;
                            const constant = value.kind === "int" || value.kind === "float";
                            if (nextWhile === 0 && nextIf === 0 && constant && statement.op === "=") {
                                entry.transferable = value;
                                entry.firstAssignDead = true;
                            }
                        }
                    } else if (nextWhile === 0 && nextIf === 0) {
                        // A second unconditional plain store before any read makes the first one dead.
                        if (entry.firstAssignPure && statement.op === "=") entry.firstAssignDead = true;
                    } else if (!pure && at === entry.firstAssignAt) {
                        entry.firstAssignPure = false;
                    }
                }
                // A compound assignment reads its target on the way through.
                if (statement.op !== "=") markRead(slot, at);
                readExpr(statement.value, at);
                return;
            }
            case "block":
                for (const child of statement.body) walk(child, nextWhile, nextIf, current);
                return;
            case "if":
                readExpr(statement.cond, at);
                branchBodies.add(statement.thenBranch);
                walk(statement.thenBranch, nextWhile, nextIf, current);
                if (statement.elseBranch) {
                    branchBodies.add(statement.elseBranch);
                    walk(statement.elseBranch, nextWhile, nextIf, current);
                }
                return;
            case "while":
                readExpr(statement.cond, at);
                branchBodies.add(statement.body);
                walk(statement.body, nextWhile, nextIf, current);
                return;
            default:
                forEachExpr(statement, (e) => {
                    if (e.kind === "var" && e.scope === "local") markRead(e.index, at);
                });
        }
    };

    for (const statement of procedure.body) walk(statement, 0, 0, { at: 0, stmt: statement });
    return usage;
}

/** Drops a statement wherever it sits in the tree, pruning containers left empty. */
function removeStatement(statements: Stmt[], target: Stmt): Stmt[] {
    const one = (statement: Stmt): Stmt | null => {
        if (statement === target) return null;
        switch (statement.kind) {
            case "block": {
                const body = removeStatement(statement.body, target);
                return body.length > 0 ? { ...statement, body } : null;
            }
            case "if": {
                const thenBranch = one(statement.thenBranch) ?? { kind: "block" as const, body: [] };
                // Spreading the original would keep an `else` this pass just emptied, and the emitter
                // would still write the jump over it, so the key is overwritten rather than merged.
                const elseBranch = statement.elseBranch ? one(statement.elseBranch) : undefined;
                return { ...statement, thenBranch, elseBranch: elseBranch ?? undefined };
            }
            case "while":
                return { ...statement, body: one(statement.body) ?? { kind: "block", body: [] } };
            default:
                return statement;
        }
    };
    return statements.flatMap((statement) => {
        const kept = one(statement);
        return kept === null ? [] : [kept];
    });
}

/** Drops every assignment to one local inside a loop, which is how the reference eats stores there. */
function removeAssignsTo(statements: Stmt[], slot: number): Stmt[] {
    const one = (statement: Stmt): Stmt | null => {
        switch (statement.kind) {
            case "assign":
                return statement.target.scope === "local" && statement.target.index === slot ? null : statement;
            case "block": {
                const body = removeAssignsTo(statement.body, slot);
                return body.length > 0 ? { ...statement, body } : null;
            }
            case "if": {
                const thenBranch = one(statement.thenBranch) ?? { kind: "block" as const, body: [] };
                // Spreading the original would keep an `else` this pass just emptied, and the emitter
                // would still write the jump over it, so the key is overwritten rather than merged.
                const elseBranch = statement.elseBranch ? one(statement.elseBranch) : undefined;
                return { ...statement, thenBranch, elseBranch: elseBranch ?? undefined };
            }
            case "while":
                return { ...statement, body: one(statement.body) ?? { kind: "block", body: [] } };
            default:
                return statement;
        }
    };
    return statements.flatMap((statement) => {
        const kept = one(statement);
        return kept === null ? [] : [kept];
    });
}

/**
 * The reference's dead-store rule, which is a first/last-assignment heuristic rather than liveness.
 *
 * Two cases per variable, re-analysed after every removal because eating one store changes the next
 * analysis: a first store that a later unconditional store overwrites before any read - whose constant
 * value moves into the variable's declaration when it has one - and a last store that nothing reads
 * afterwards, provided it is pure and is not itself the body of a branch.
 */
function deadStoreRemoval(procedure: ProcedureDecl): { procedure: ProcedureDecl; changed: boolean } {
    let body = procedure.body;
    let locals = procedure.locals;
    let changed = false;
    for (;;) {
        const usage = analyzeVarUsage({ ...procedure, body, locals });
        let acted = false;
        for (const [slot, entry] of [...usage.entries()].sort((a, b) => a[0] - b[0])) {
            if (entry.firstAssignDead && entry.firstAssign) {
                const index = slot - procedure.args.length;
                const initial = entry.transferable;
                // The store was a constant, so it becomes the declared initial value instead.
                if (initial && locals[index] && (initial.kind === "int" || initial.kind === "float")) {
                    const next = [...locals];
                    next[index] = { ...(locals[index] as VariableDecl), initial };
                    locals = next;
                }
                body = removeStatement(body, entry.firstAssign);
                acted = true;
                break;
            }
            if (
                entry.lastAssign &&
                entry.lastAssignAt >= entry.lastUseAt &&
                entry.lastAssignPure &&
                !entry.lastAssignIsBranchBody &&
                (!entry.lastAssignInWhile || entry.lastAssignAt > entry.lastUseAt)
            ) {
                body = entry.lastAssignInWhile ? removeAssignsTo(body, slot) : removeStatement(body, entry.lastAssign);
                acted = true;
                break;
            }
        }
        if (!acted) break;
        changed = true;
    }
    return { procedure: { ...procedure, body, locals }, changed };
}

/**
 * `x := A; x += B;` becomes `x := A + B`. Only an immediately preceding plain store to the same variable
 * qualifies - anything between them could observe the intermediate value.
 */
function combineAssignments(statements: Stmt[]): { body: Stmt[]; changed: boolean } {
    let changed = false;
    const fuse = (list: Stmt[]): Stmt[] => {
        const out: Stmt[] = [];
        for (const statement of list) {
            const previous = out[out.length - 1];
            if (
                previous?.kind === "assign" &&
                previous.op === "=" &&
                statement.kind === "assign" &&
                statement.op !== "=" &&
                statement.target.scope === previous.target.scope &&
                statement.target.index === previous.target.index
            ) {
                const op = statement.op.slice(0, -1) as BinaryOp;
                if (BINARY_FUSE_OPS.has(op)) {
                    out[out.length - 1] = {
                        ...previous,
                        value: { kind: "binary", op, left: previous.value, right: statement.value },
                    };
                    changed = true;
                    continue;
                }
            }
            out.push(descend(statement));
        }
        return out;
    };
    const descend = (statement: Stmt): Stmt => {
        switch (statement.kind) {
            case "block":
                return { ...statement, body: fuse(statement.body) };
            case "if":
                return {
                    ...statement,
                    thenBranch: descend(statement.thenBranch),
                    ...(statement.elseBranch ? { elseBranch: descend(statement.elseBranch) } : {}),
                };
            case "while":
                return { ...statement, body: descend(statement.body) };
            default:
                return statement;
        }
    };
    return { body: fuse(statements), changed };
}

const BINARY_FUSE_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/"]);

/**
 * Removes locals nothing mentions at all and renumbers the rest. Distinct from the dead-store pass: this
 * counts every mention, read or write, so it only fires once the stores are already gone.
 *
 * Arguments occupy the leading slots and are never dropped - the procedure table records how many there
 * are, so removing one would change the calling convention.
 */
function deadVariableRemoval(procedure: ProcedureDecl): ProcedureDecl {
    const base = procedure.args.length;
    const mentioned = new Set<number>();
    for (const statement of procedure.body) {
        forEachExpr(statement, (expr) => {
            if (expr.kind === "var" && expr.scope === "local") mentioned.add(expr.index);
        });
    }
    if (procedure.conditional) {
        forEachExpr({ kind: "expr", expr: procedure.conditional }, (expr) => {
            if (expr.kind === "var" && expr.scope === "local") mentioned.add(expr.index);
        });
    }

    const keep = procedure.locals.map((_local, i) => mentioned.has(base + i));
    if (keep.every(Boolean)) return procedure;

    const slotMap = new Map<number, number>();
    for (let arg = 0; arg < base; arg++) slotMap.set(arg, arg);
    let next = base;
    procedure.locals.forEach((_local, i) => {
        if (keep[i]) slotMap.set(base + i, next++);
    });

    const renumber = (expr: Expr): Expr =>
        expr.kind === "var" && expr.scope === "local"
            ? { ...expr, index: slotMap.get(expr.index) ?? expr.index }
            : expr;
    return {
        ...procedure,
        locals: procedure.locals.filter((_local, i) => keep[i]),
        body: procedure.body.map((statement) => remapWith(statement, renumber)),
    };
}

/**
 * One procedure through the reference's own pass order, looped until nothing moves.
 *
 * The order matters and is not arbitrary: folding exposes constant conditions, dead-code removal deletes
 * what those conditions decide, that strands stores, and combining assignments creates new folding
 * opportunities - so the whole set repeats rather than running once.
 */
function optimizeProcedure(procedure: ProcedureDecl): ProcedureDecl {
    let body = procedure.body;
    let locals = procedure.locals;
    for (let round = 0; round < 32; round++) {
        let changed = false;

        const folded = body.map((statement) => remapWith(statement, foldConstants));
        if (JSON.stringify(folded) !== JSON.stringify(body)) changed = true;
        body = folded;

        const stores = deadStoreRemoval({ ...procedure, body, locals });
        body = stores.procedure.body;
        locals = stores.procedure.locals;
        changed ||= stores.changed;

        const reduced = foldStatements(body);
        if (JSON.stringify(reduced) !== JSON.stringify(body)) changed = true;
        body = reduced;

        const combined = combineAssignments(body);
        body = combined.body;
        changed ||= combined.changed;

        if (!changed) break;
    }
    // One last fold: the loop exits on the round that changed nothing, but `deadVariableRemoval` below
    // only renumbers, so anything the final round's store removal emptied has to be cleaned up here.
    return deadVariableRemoval({ ...procedure, body: foldStatements(body), locals });
}

/**
 * Replaces reads of a global that is never assigned with its initial value. The variable then has no
 * readers left and the removal pass drops it, which is how the reference turns a `variable x := 12;`
 * used purely as a constant into an immediate.
 *
 * An EXPORTED global is excluded: another script may assign it, so its value is not ours to assume.
 * Imports are excluded for the same reason - their definition, and any writes to it, live elsewhere.
 */
function propagateConstantGlobals(program: Program): Program {
    const assigned = new Set<number>();
    for (const procedure of proceduresOf(program)) {
        const walk = (stmt: Stmt): void => {
            if (stmt.kind === "assign" && stmt.target.scope === "global") assigned.add(stmt.target.index);
            if (stmt.kind === "block") stmt.body.forEach(walk);
            if (stmt.kind === "if") {
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
            }
            if (stmt.kind === "while") walk(stmt.body);
        };
        procedure.body.forEach(walk);
    }

    // A global reached through `call` holds a procedure, and substituting its initial value would turn
    // the call target into an integer the emitter cannot call. Its value comes from somewhere this
    // analysis cannot see, which is exactly the case the substitution must not guess at.
    const called = new Set<number>();
    for (const procedure of proceduresOf(program)) {
        const note = (target: Expr): void => {
            if (target.kind === "var" && target.scope === "global") called.add(target.index);
        };
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "call") note(expr.target);
        });
        const walk = (stmt: Stmt): void => {
            if (stmt.kind === "callStmt") note(stmt.target);
            if (stmt.kind === "block") stmt.body.forEach(walk);
            if (stmt.kind === "if") {
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
            }
            if (stmt.kind === "while") walk(stmt.body);
        };
        procedure.body.forEach(walk);
    }

    const constants = new Map<number, Expr>();
    globalsOf(program).forEach((variable, index) => {
        if (!assigned.has(index) && !variable.exported && !called.has(index)) constants.set(index, variable.initial);
    });
    if (constants.size === 0) return program;

    const substitute = (expr: Expr): Expr =>
        expr.kind === "var" && expr.scope === "global" ? (constants.get(expr.index) ?? expr) : expr;

    return {
        ...program,
        declarations: program.declarations.map((declaration) =>
            declaration.kind === "procedure"
                ? {
                      kind: "procedure",
                      procedure: {
                          ...declaration.procedure,
                          body: declaration.procedure.body.map((s) => remapWith(s, substitute)),
                      },
                  }
                : declaration,
        ),
    };
}

/**
 * Removes procedures nothing can reach and globals nothing reads, then renumbers what is left. Both
 * index spaces are positional - a procedure's slot is its position among procedure declarations, a
 * global's is its position among global ones - so dropping any entry shifts every later reference.
 */
export function optimize(program: Program, options: OptimizeOptions = {}): Program {
    const level = options.level ?? 0;
    if (level < 1) return program;

    // Level 2 rewrites bodies BEFORE reachability is computed: folding away a constant branch can make a
    // call unreachable, and that call was the only thing keeping a procedure alive.
    if (level >= 2) {
        // Twice, with propagation between: substituting a constant global exposes arithmetic that folds,
        // which can decide a branch, which can strand more locals. One pass would stop short of what the
        // reference reaches.
        const simplify = (input: Program): Program => ({
            ...input,
            declarations: input.declarations.map((declaration) =>
                declaration.kind === "procedure"
                    ? { kind: "procedure", procedure: optimizeProcedure(declaration.procedure) }
                    : declaration,
            ),
        });
        // The reference's own outer loop: optimise every body, propagate whatever globals that made
        // constant, and go round again, because a propagated constant can decide a branch that strands
        // another procedure. It stops when a full round changes nothing.
        for (let round = 0; round < 16; round++) {
            const before = program;
            program = simplify(program);
            const propagated = propagateConstantGlobals(program);
            const moved = propagated !== program;
            program = propagated;
            if (!moved && JSON.stringify(program) === JSON.stringify(before)) break;
        }
    }

    const keepAllProcedures = hasDynamicProcedureLookup(program);
    const reachable = keepAllProcedures ? null : reachableProcedures(program);

    const procedureMap = new Map<number, number>();
    let nextProcedure = 0;
    proceduresOf(program).forEach((_procedure, index) => {
        if (reachable === null || reachable.has(index)) procedureMap.set(index, nextProcedure++);
    });

    // Variables are counted only against the procedures that survive, so one read exclusively by dead
    // code goes with it. Globals are held by slot; an import is reached by name, which is why it can be
    // dropped without renumbering anything.
    const usedGlobals = new Set<number>();
    const usedExternals = new Set<string>();
    proceduresOf(program).forEach((procedure, index) => {
        if (!procedureMap.has(index)) return;
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind !== "var") return;
            if (expr.scope === "global") usedGlobals.add(expr.index);
            if (expr.scope === "external") usedExternals.add(expr.name);
        });
    });

    const globalMap = new Map<number, number>();
    let nextGlobal = 0;
    globalsOf(program).forEach((variable, index) => {
        // An exported global is part of the script's interface: another script reads it by name.
        if (usedGlobals.has(index) || variable.exported) globalMap.set(index, nextGlobal++);
    });

    let procedureIndex = -1;
    let globalIndex = -1;
    const declarations: Declaration[] = [];
    const liveStrings = new Set<string>();
    for (const declaration of program.declarations) {
        if (declaration.kind === "procedure") {
            procedureIndex++;
            if (!procedureMap.has(procedureIndex)) continue;
            declarations.push({
                kind: "procedure",
                procedure: rewriteProcedure(declaration.procedure, procedureMap, globalMap),
            });
            continue;
        }
        if (declaration.kind === "global") {
            globalIndex++;
            if (!globalMap.has(globalIndex)) continue;
        }
        // An import the script never mentions binds a name it then does nothing with. Exported ones stay
        // regardless: the export IS the reference, made by another script.
        if (
            declaration.kind === "external" &&
            !declaration.variable.exported &&
            !usedExternals.has(declaration.variable.name)
        ) {
            continue;
        }
        declarations.push(declaration);
    }

    // The string table is built from a SOURCE-ORDER list, not from the IR, so a literal used only by
    // code just removed would still be interned and shift every later string offset. Collect what the
    // survivors actually reference and keep the list in its original order.
    const survivingProcedures = declarations.flatMap((d) => (d.kind === "procedure" ? [d.procedure] : []));
    for (const procedure of survivingProcedures) {
        // A local's initial value is pushed at procedure entry and never appears in the body, so the
        // expression walk below cannot see it. Dropping one leaves the emitter to intern it late, at the
        // END of the table, which reorders every offset rather than merely losing a string.
        for (const local of procedure.locals) {
            if (local.initial.kind === "string") liveStrings.add(local.initial.value);
        }
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "string") liveStrings.add(expr.value);
            // A procedure passed by name has its NAME interned as a string, not as an identifier.
            if (expr.kind === "procRef" && expr.stringify) {
                const named = survivingProcedures[expr.index];
                if (named) liveStrings.add(named.name);
            }
        });
    }
    for (const declaration of declarations) {
        if (declaration.kind !== "procedure" && declaration.variable.initial.kind === "string") {
            liveStrings.add(declaration.variable.initial.value);
        }
    }

    const stringLiterals = program.stringLiterals?.filter((literal) => liveStrings.has(literal));

    // An undefined procedure that was removed as dead is no longer anybody's problem; the survivors keep
    // their complaint, renumbered alongside everything else.
    const undefinedProcedures = program.undefinedProcedures
        ?.filter((entry) => procedureMap.has(entry.index))
        .map((entry) => ({ ...entry, index: procedureMap.get(entry.index) as number }));

    return {
        ...program,
        declarations,
        ...(stringLiterals ? { stringLiterals } : {}),
        // Emptying the table is not the same as never having had one; the emitter writes them apart.
        ...((program.stringLiterals?.length ?? 0) > 0 ? { stringTableAllocated: true } : {}),
        ...(undefinedProcedures && undefinedProcedures.length > 0
            ? { undefinedProcedures }
            : { undefinedProcedures: undefined }),
    };
}
