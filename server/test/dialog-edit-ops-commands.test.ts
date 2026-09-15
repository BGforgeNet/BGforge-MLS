/**
 * Model-based (fc.commands) test for the dialog edit ops.
 *
 * The per-operation tests in dialog-edit-ops.test.ts each start from a pristine model. The editor does not:
 * it applies a sequence of edits to one shared mutable model and saves once. This drives random sequences of
 * the structural ops and re-checks, after EVERY command, the two invariants a save depends on:
 *
 *   1. No dangling transition - every GOTO target names a state in its own dialogue.
 *   2. Round-trip - writing the accumulated edits and re-parsing the result yields the same states,
 *      transition order and targets as the in-memory model.
 *
 * WeiDU D is the family under test because its writer round-trips through a full re-parse; ids and texts come
 * from a small alphabet so a failure points at the ops rather than at identifier escaping.
 */

import * as fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD, type DialogModel, type DialogState, type DialogTarget } from "../../shared/dialog-model";
import { applyDDialogEdits } from "../../shared/dialog-d-edit";
import * as ops from "../../shared/dialog-edit-ops";

const SRC = `APPEND ~coranj~
IF ~~ THEN BEGIN hello SAY ~Hi.~ IF ~~ THEN REPLY ~more~ GOTO more IF ~~ THEN REPLY ~bye~ EXIT END
IF ~~ THEN BEGIN more SAY ~More.~ IF ~~ THEN REPLY ~back~ GOTO hello END
END
`;

const NAMES = ["alpha", "beta", "gamma", "delta"];
const WORDS = ["yes", "no", "wait", "leave"];

beforeAll(async () => {
    await initParser();
});

// ---------------------------------------------------------------------------
// Projection and invariants
// ---------------------------------------------------------------------------

interface StateShape {
    readonly id: string;
    readonly text: string;
    readonly choices: readonly { text: string | undefined; target: string }[];
}

function targetKey(t: DialogTarget): string {
    if (t.kind === "state") return `state:${t.stateId}`;
    if (t.kind === "external") return `external:${t.label}`;
    return t.kind;
}

/** The part of a model a save must preserve: states in order, their line, and their transitions in order. */
function project(model: DialogModel): StateShape[] {
    return model.roots.flatMap((r) =>
        r.states.map((s) => ({
            id: s.id,
            text: s.text,
            choices: s.choices.map((c) => ({ text: c.text, target: targetKey(c.target) })),
        })),
    );
}

/** Every GOTO target must name a state of its own dialogue - a dangling one is a WeiDU compile error. */
function danglingTargets(model: DialogModel): string[] {
    const bad: string[] = [];
    for (const root of model.roots) {
        const ids = new Set(root.states.map((s) => s.id));
        for (const s of root.states) {
            for (const c of s.choices) {
                if (c.target.kind === "state" && !ids.has(c.target.stateId)) {
                    bad.push(`${s.id} -> ${c.target.stateId}`);
                }
            }
        }
    }
    return bad;
}

function checkInvariants(model: DialogModel): void {
    expect(danglingTargets(model)).toEqual([]);
    const out = applyDDialogEdits(SRC, model, modelFromD(parseDDialog(SRC)));
    expect(project(modelFromD(parseDDialog(out)))).toEqual(project(model));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Real system under test: the one model the editor mutates across a session. */
interface Real {
    model: DialogModel;
}

/** Abstract state: enough to gate a command's preconditions (ids are unique, indexes are in range). */
interface Abstract {
    states: { id: string; choices: number }[];
}

type Cmd = fc.Command<Abstract, Real>;

/** All states of the model, flattened the same way the abstract state is. */
const statesOf = (r: Real): DialogState[] => r.model.roots.flatMap((root) => root.states);

/** Re-derive the abstract state from the real one, so preconditions see what the ops actually did. */
function sync(m: Abstract, r: Real): void {
    m.states = statesOf(r).map((s) => ({ id: s.id, choices: s.choices.length }));
}

/** A command whose `run` mutates the model, re-syncs the abstract state and re-checks both invariants. */
function command(label: string, check: (m: Abstract) => boolean, mutate: (r: Real) => void): Cmd {
    return {
        check,
        run(m: Abstract, r: Real): void {
            mutate(r);
            sync(m, r);
            checkInvariants(r.model);
        },
        toString: () => label,
    };
}

/** States with more than one transition - the ones remove/move can act on without emptying a state. */
const multiChoice = (r: Real): DialogState[] => statesOf(r).filter((s) => s.choices.length > 1);

const pick = <T>(xs: readonly T[], at: number): T => xs[at % xs.length]!;

function addState(id: string, text: string): Cmd {
    return command(
        `addState(${id}, ${text})`,
        (m) => !m.states.some((s) => s.id === id),
        (r) => {
            const st = ops.addState(r.model, r.model.roots[0], id);
            st.text = text;
            ops.addReply(r.model, st).text = text;
        },
    );
}

function renameState(at: number, id: string): Cmd {
    return command(
        `renameState(${at}, ${id})`,
        (m) => m.states.length > 0 && !m.states.some((s) => s.id === id),
        (r) => {
            ops.renameState(r.model, pick(statesOf(r), at), id);
        },
    );
}

function deleteState(at: number): Cmd {
    return command(
        `deleteState(${at})`,
        (m) => m.states.length > 1,
        (r) => {
            ops.deleteState(r.model, pick(statesOf(r), at));
        },
    );
}

function addReply(at: number, text: string): Cmd {
    return command(
        `addReply(${at}, ${text})`,
        (m) => m.states.length > 0,
        (r) => {
            ops.addReply(r.model, pick(statesOf(r), at)).text = text;
        },
    );
}

function removeReply(at: number, choiceAt: number): Cmd {
    return command(
        `removeReply(${at}, ${choiceAt})`,
        (m) => m.states.some((s) => s.choices > 1),
        (r) => {
            const st = pick(multiChoice(r), at);
            ops.removeReply(st, pick(st.choices, choiceAt).id);
        },
    );
}

function moveReply(at: number, choiceAt: number, dir: -1 | 1): Cmd {
    return command(
        `moveReply(${at}, ${choiceAt}, ${dir})`,
        (m) => m.states.some((s) => s.choices > 1),
        (r) => {
            const st = pick(multiChoice(r), at);
            ops.moveReply(st, pick(st.choices, choiceAt).id, dir);
        },
    );
}

function retarget(at: number, choiceAt: number, targetAt: number, toExit: boolean): Cmd {
    return command(
        `retarget(${at}, ${choiceAt}, ${toExit ? "exit" : targetAt})`,
        (m) => m.states.some((s) => s.choices > 0),
        (r) => {
            const root = r.model.roots[0]!;
            const st = pick(
                root.states.filter((s) => s.choices.length > 0),
                at,
            );
            const to = pick(root.states, targetAt);
            const target: DialogTarget = toExit ? { kind: "exit" } : { kind: "state", stateId: to.id };
            ops.setChoiceTarget(st, pick(st.choices, choiceAt).id, target);
        },
    );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

const name = fc.constantFrom(...NAMES);
const word = fc.constantFrom(...WORDS);
const index = fc.nat({ max: 8 });

const commands: fc.Arbitrary<Cmd>[] = [
    fc.tuple(name, word).map(([id, text]) => addState(id, text)),
    fc.tuple(index, name).map(([at, id]) => renameState(at, id)),
    index.map((at) => deleteState(at)),
    fc.tuple(index, word).map(([at, text]) => addReply(at, text)),
    fc.tuple(index, index).map(([at, c]) => removeReply(at, c)),
    fc.tuple(index, index, fc.constantFrom<-1 | 1>(-1, 1)).map(([at, c, d]) => moveReply(at, c, d)),
    fc.tuple(index, index, index, fc.boolean()).map(([at, c, t, exit]) => retarget(at, c, t, exit)),
];

describe("dialog-edit-ops under sequences of edits", () => {
    it("keeps every edit sequence dangling-free and round-trippable through the D writer", () => {
        fc.assert(
            fc.property(fc.commands(commands, { maxCommands: 12 }), (cmds) => {
                fc.modelRun(() => {
                    const real: Real = { model: modelFromD(parseDDialog(SRC)) };
                    const abstract: Abstract = { states: [] };
                    sync(abstract, real);
                    return { model: abstract, real };
                }, cmds);
            }),
            { numRuns: 100 },
        );
    });
});
