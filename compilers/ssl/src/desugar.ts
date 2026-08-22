/**
 * The expansions shared by every front end: the four constructs with no instruction of their own, which
 * become a shape built out of ones that do.
 *
 * They live here rather than in `lower.ts` because their output is fixed by invariants that are
 * expensive to rediscover and silent when broken - the order temporaries are allocated in decides both
 * their `tmp.<n>` names and every local slot index after them, and a literal's nesting depth is part of
 * the emitted code. A second front end that reimplemented these would be re-deriving what the corpus
 * differential pinned, and would agree with this one on every script that happens not to exercise the
 * difference.
 *
 * What stays with the front end is name resolution, which `int/ir.ts` makes its responsibility: nothing
 * here maps a name to a slot. Operands arrive as thunks instead of values precisely so this file keeps
 * the ordering decision - see `Deferred`.
 */

import type { Expr, Stmt, VariableDecl } from "./int/ir";

/** Where a construct was written, in the coordinates a diagnostic uses. */
export interface Origin {
    line: number;
    column: number;
}

/** A name the source wrote, and where. */
export interface NameRef {
    text: string;
    origin: Origin;
}

/** A variable slot. The expansions assign to their temporaries, so a bare `Expr` will not do. */
export type VarExpr = Extract<Expr, { kind: "var" }>;

/**
 * An operand the expansion evaluates at a point of its own choosing.
 *
 * Deferred rather than passed by value because WHEN an operand is lowered decides which slots it takes:
 * every expansion below allocates temporaries around its operands, so an operand lowered eagerly by the
 * front end would take the slot a temporary is due and shift every index after it. Handing over a thunk
 * is what keeps that ordering here, where it can be stated once.
 */
export type Deferred<T> = () => T;

/** What an expansion needs from whichever front end is driving it. */
export interface Desugarer {
    /** Allocates a named local slot, warning if the name is already taken in this scope. */
    declareLocal(name: string, initial: VariableDecl["initial"], origin: Origin): VarExpr;
    /** Allocates an unnamed local slot. Its name cannot collide, so this never warns. */
    newTemp(): VarExpr;
    engineCall(name: string, args: Expr[], origin: Origin): Expr;
    /** Records a user error and yields the stand-in that lets the walk carry on. */
    report(message: string, origin: Origin): Expr;
}

export interface ForForm {
    origin: Origin;
    init: Deferred<Stmt | null> | null;
    cond: Deferred<Expr> | null;
    update: Deferred<Stmt | null> | null;
    body: Deferred<Stmt> | null;
}

export interface ForeachForm {
    origin: Origin;
    /** The loop variables this statement declares, in written order; absent when it names existing ones. */
    declares: { key: NameRef | null; value: NameRef } | null;
    /**
     * The array. `isVariable` says it is already a plain variable, which is iterated in place; anything
     * else is evaluated once into a temporary so a call is not repeated per iteration.
     */
    subject: { isVariable: boolean; get: Deferred<Expr> };
    /** Resolves the key variable. Absent when the source named none and a temporary stands in. */
    key: Deferred<Expr> | null;
    value: Deferred<Expr>;
    guard: Deferred<Expr> | null;
    body: Deferred<Stmt> | null;
}

export interface SwitchForm {
    origin: Origin;
    subject: { isVariable: boolean; get: Deferred<Expr> };
    cases: { value: Deferred<Expr>; body: Deferred<Stmt[]> }[];
    fallback: Deferred<Stmt[]> | null;
}

export interface ArrayLiteralForm {
    origin: Origin;
    isMap: boolean;
    /** Entries in written order. `key` is present exactly for a map; an array numbers its own from zero. */
    entries: { key: Deferred<Expr> | null; value: Deferred<Expr> }[];
}

/**
 * What a reported expression lowers to so the walk can continue past it.
 *
 * Nothing is emitted while there are diagnostics, so this value never reaches an output file; its only
 * job is to be a well-formed `Expr` that the rest of lowering can consume without special-casing. It is
 * compared by IDENTITY, which is what lets a site tell "already reported" from a genuine zero and avoid
 * complaining twice about one mistake.
 */
export const POISON: Expr = { kind: "int", value: 0 };

/** Marks a literal built inside another array expression, and the terminator that closes one. */
const ARRAY_FLAG_EXPR_PUSH = 32;
const ARRAY_FLAG_EXPR_POP = 64;

/**
 * The expansions, carrying the one piece of state they share: how deep inside an array literal we are.
 * Nesting is tracked here rather than passed in because a nested literal is reached by the front end
 * lowering an operand thunk, so the depth has to survive a round trip out through the front end.
 *
 * The `Desugarer` arrives per call rather than per instance because a front end binds it to the scope
 * the expansion runs in, and one instance has to span every scope for the nesting count to hold.
 */
export class Expansions {
    private arrayNesting = 0;

    /**
     * `for (init; cond; update) body`.
     *
     * Lowering order is the reference's PARSE order - init, condition, update, then body - because slots
     * are allocated as they are encountered, so a different order here renumbers them. An absent
     * condition is not "loop forever" by omission: the reference requires the expression, so a missing
     * one is a source error rather than something to substitute a default for.
     */
    for(host: Desugarer, form: ForForm): Stmt {
        const init = form.init?.() ?? null;
        const cond = form.cond ? form.cond() : host.report("for loop has no condition", form.origin);
        const update = form.update?.() ?? null;

        const inner: Stmt[] = [];
        if (form.body) inner.push(form.body());
        inner.push({ kind: "loopEnd" });
        if (update) inner.push(update);

        const loop: Stmt = { kind: "while", cond, body: { kind: "block", body: inner } };
        return init ? { kind: "block", body: [init, loop] } : loop;
    }

    /**
     * `foreach v in arr do body` walks an array by index. It expands to:
     *
     *     count := 0;  len := len_array(arr);
     *     while (count < len) do begin
     *         key := array_key(arr, count);
     *         v   := get_array(arr, key);
     *         body
     *         LOOP_END
     *         count += 1;
     *     end
     *
     * Three details are load-bearing for the output rather than cosmetic. The subject is evaluated into
     * a temporary UNLESS it is already a plain variable, so a call is not re-evaluated per iteration.
     * The temporaries are allocated in a fixed order - subject, len, count, then the key when the source
     * named none - because that order fixes both their `tmp.<n>` names and their slot indices. And the
     * key is fetched separately from the value so the same expansion serves associative arrays, where
     * the index and the key differ.
     */
    foreach(host: Desugarer, form: ForeachForm): Stmt {
        const statements: Stmt[] = [];

        // The loop variables are declared as they are READ - before `in`, and so before any temporary
        // exists. Allocating the temporaries first shifts every later slot by one.
        if (form.declares) {
            const { key, value } = form.declares;
            if (key) host.declareLocal(key.text, { kind: "int", value: 0 }, key.origin);
            host.declareLocal(value.text, { kind: "int", value: 0 }, value.origin);
        }

        let subject: Expr;
        if (form.subject.isVariable) {
            subject = form.subject.get();
        } else {
            const temp = host.newTemp();
            statements.push({ kind: "assign", target: temp, op: "=", value: form.subject.get() });
            subject = temp;
        }

        const len = host.newTemp();
        const count = host.newTemp();
        const key = form.key ? form.key() : host.newTemp();
        const value = form.value();
        // A loop the source did not declare names existing variables, so either name can be something
        // else entirely; the temporaries above are variables by construction.
        if (key.kind !== "var" || value.kind !== "var") {
            const offender = key.kind === "var" ? value : key;
            if (offender !== POISON) host.report("foreach loop variable is not a variable", form.origin);
            return { kind: "block", body: statements };
        }

        const call = (name: string, args: Expr[]): Expr => host.engineCall(name, args, form.origin);

        statements.push(
            { kind: "assign", target: count, op: "=", value: { kind: "int", value: 0 } },
            { kind: "assign", target: len, op: "=", value: call("len_array", [subject]) },
        );

        let condition: Expr = { kind: "binary", op: "<", left: count, right: len };
        if (form.guard) {
            condition = { kind: "binary", op: "and", left: condition, right: form.guard() };
        }

        const inner: Stmt[] = [
            { kind: "assign", target: key, op: "=", value: call("array_key", [subject, count]) },
            { kind: "assign", target: value, op: "=", value: call("get_array", [subject, key]) },
        ];
        if (form.body) inner.push(form.body());
        inner.push({ kind: "loopEnd" }, { kind: "assign", target: count, op: "+=", value: { kind: "int", value: 1 } });

        statements.push({ kind: "while", cond: condition, body: { kind: "block", body: inner } });
        return { kind: "block", body: statements };
    }

    /**
     * `switch` is a nested if/else-if chain over equality comparisons, not a jump table. The subject is
     * evaluated into a temporary unless it is already a plain variable, so it is tested once per case
     * without being recomputed.
     *
     * There is no fallthrough to model: each case's statements are its own branch, and `default` becomes
     * the innermost else. The chain is built INNERMOST-FIRST, so the fallback's operands are lowered
     * before any case's and the cases' in reverse - which would decide slot order for anything a clause
     * body declares. Nothing in the corpus does: across its 33 switch statements and 123 clauses, not one
     * declares a local, so the differential cannot say whether the reference agrees and this order stands
     * because it is what the digests were taken against.
     */
    switch(host: Desugarer, form: SwitchForm): Stmt {
        const statements: Stmt[] = [];
        let subject: Expr;
        if (form.subject.isVariable) {
            subject = form.subject.get();
        } else {
            const temp = host.newTemp();
            statements.push({ kind: "assign", target: temp, op: "=", value: form.subject.get() });
            subject = temp;
        }

        // A lone `default` does not qualify: the language wants at least one case, so the whole
        // statement is refused rather than reduced to its fallback.
        if (form.cases.length === 0) host.report("switch statement with no cases", form.origin);

        let chain: Stmt | undefined = form.fallback ? { kind: "block", body: form.fallback() } : undefined;
        for (let index = form.cases.length - 1; index >= 0; index--) {
            const clause = form.cases[index] as SwitchForm["cases"][number];
            const branch: Stmt = {
                kind: "if",
                cond: { kind: "binary", op: "==", left: subject, right: clause.value() },
                thenBranch: { kind: "block", body: clause.body() },
            };
            chain = chain ? { ...branch, elseBranch: chain } : branch;
        }

        if (chain) statements.push(chain);
        return statements.length === 1 ? (statements[0] as Stmt) : { kind: "block", body: statements };
    }

    /**
     * Array and map literals build their value by SUMMING engine calls rather than by any dedicated
     * instruction: a `temp_array` seed plus one `arrayexpr(key, value)` term per entry, added left to
     * right. An array numbers its own keys from zero; a map takes the written key.
     *
     * The seed's size argument distinguishes the two (0 for an array, -1 for a map), and its flags
     * argument marks a NESTED literal, which additionally emits a terminator so the engine's expression
     * stack unwinds. Nesting depth is therefore part of the emitted code, not just a parsing concern.
     */
    arrayLiteral(host: Desugarer, form: ArrayLiteralForm): Expr {
        this.arrayNesting++;
        try {
            const nested = this.arrayNesting > 1;
            const call = (name: string, args: Expr[]): Expr => host.engineCall(name, args, form.origin);

            let result: Expr = call("temp_array", [
                { kind: "int", value: form.isMap ? -1 : 0 },
                { kind: "int", value: nested ? ARRAY_FLAG_EXPR_PUSH : 0 },
            ]);
            const add = (term: Expr): void => {
                result = { kind: "binary", op: "+", left: result, right: term };
            };

            let index = 0;
            for (const entry of form.entries) {
                // The key is lowered before the value, as it is written; an array's own index needs no
                // lowering at all.
                const key: Expr = entry.key ? entry.key() : { kind: "int", value: index++ };
                add(call("arrayexpr", [key, entry.value()]));
            }

            if (nested) {
                add(
                    call("temp_array", [
                        { kind: "int", value: 0 },
                        { kind: "int", value: ARRAY_FLAG_EXPR_POP },
                    ]),
                );
            }
            return result;
        } finally {
            this.arrayNesting--;
        }
    }
}
