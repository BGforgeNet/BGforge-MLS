/**
 * Shared corpus WRITE-BACK harness, run against every dialog family's REAL external corpus.
 *
 * The unit suites validate each family's writer on ONE hand-built fixture apiece - and that fixture is the easy
 * shape on every axis (statement-form transitions, single-line lists, no trailing commas). Real authored dialogs
 * carry the variants a formatter emits (chain-form transitions, multi-line variadic lists WITH trailing commas,
 * quoted resrefs, nested gates, EXTEND blocks). A double-comma add-node splice that broke ts-morph on the first
 * real `.td` file shipped green precisely because no test drove the writer over that shape. This harness closes
 * the class: it parses hundreds of real dialogs once and runs the FULL edit battery through the same
 * `apply*DialogEdits` the webview save path calls, asserting the TARGETED invariant of each op (re-parses, the
 * intended change is present, no inbound reference to a removed/renamed node is left dangling) - not the wishful
 * "it still parsed to N states".
 *
 * Family-agnostic by construction: every op is a model-level `dialog-edit-ops` call over the shared `DialogModel`,
 * so one battery covers SSL / D / TD / TSSL; only parse + apply + the corpus glob differ per family. Requires the
 * external repos (`pnpm test:external`); each family skips itself when its corpus is not checked out.
 *
 * Assertions are REACHABILITY-ROBUST. The fallout-ssl parser prunes UNREACHABLE nodes from its model, so an edit
 * that orphans a helper procedure legitimately shrinks the reparsed node set even though the source is untouched
 * and valid. Asserting an exact post-edit state count, or scanning the whole model for a dangling target, would
 * therefore false-positive on SSL (a check that flags correct output is worse than no check). So each op asserts
 * its OWN observable - the edited node's option count, the specific target that changed, the absence of a
 * reference to the id we just removed/renamed - and option sets are compared by option TEXT (`@N`, stable under
 * pruning), never by resolved target.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import {
    renderFamily,
    sslTerminalKind,
    type DialogModel,
    type DialogState,
    type DialogRoot,
    type DialogChoice,
    type DialogTarget,
} from "../../../shared/dialog-model";
import { nodeEditable, nodeDeletable } from "../../../shared/dialog-editability";
import {
    addState,
    addReply,
    removeReply,
    moveReply,
    deleteState,
    renameState,
    setChoiceTarget,
} from "../../../shared/dialog-edit-ops";

export interface FamilyCorpus {
    /** Display name for the describe block ("weidu-d", "fallout-ssl", ...). */
    family: string;
    /** Absolute paths of the real corpus files. Empty -> the family's describe block is skipped. */
    files: string[];
    /** Map an absolute path to a short label for failure messages. */
    relOf: (absPath: string) => string;
    /** One-time async setup (WASM parser init) before any parse. Omitted for the pure-JS ts-morph families. */
    init?: () => Promise<void>;
    /** Parse source text into a model. Sync families wrap their result in Promise.resolve. */
    parse: (text: string) => Promise<DialogModel>;
    /** The family's write-back: the exact function the webview save path invokes. */
    apply: (text: string, edited: DialogModel, original: DialogModel) => string;
}

interface Parsed {
    rel: string;
    text: string;
    model: DialogModel;
}

const clone = (m: DialogModel): DialogModel => structuredClone(m);
const statesOf = (m: DialogModel): DialogState[] => m.roots.flatMap((r) => r.states);
const dialogRoot = (m: DialogModel): DialogRoot | undefined => m.roots.find((r) => r.kind === "dialog") ?? m.roots[0];

/** An SSL terminal sink (Node999 = exit, Node998 = combat). The UI renders these as terminal CHIPS, never as
 *  editable nodes - you cannot rename, delete, or edit the options of "end dialog" - so the node-level battery
 *  excludes them (renaming a sink referenced by every exit option produces overlapping splices; the UI never
 *  drives it). Gated to the fallout-ssl family, where the convention holds. */
const isSslTerminal = (m: DialogModel, s: DialogState): boolean =>
    renderFamily(m.sourceLang) === "fallout-ssl" && sslTerminalKind(s.id) !== undefined;

/** A model node the UI presents as an editable node (excludes SSL terminal chips). */
const editableNode = (m: DialogModel, s: DialogState): boolean => nodeEditable(m, s) && !isSslTerminal(m, s);
const deletableNode = (m: DialogModel, s: DialogState): boolean => nodeDeletable(m, s) && !isSslTerminal(m, s);

/** Editable node AND flat: the plain `addReply`/`removeReply`/`moveReply` ops apply. An SSL bundle node (if/else)
 *  is editable but its options are BRANCH-scoped - the UI edits them with the branch-aware ops, not the flat ones
 *  - so the flat option battery below excludes bundles (a distinct op family, covered by the unit branch tests).
 *  D-family nodes have no bundles (`bundleFaithful` unset), so there `flatEditable` == `editableNode`. */
const flatEditable = (m: DialogModel, s: DialogState): boolean => editableNode(m, s) && !s.bundleFaithful;

/** Whether a choice's target can be spliced in place (has a source anchor): SSL uses `callRange`, D uses
 *  `targetRange`. Retarget on an option without one is not a UI-reachable edit. */
const retargetable = (c: DialogChoice): boolean => c.callRange !== undefined || c.targetRange !== undefined;

/** A choice's display text (`@N` ref). REACHABILITY-STABLE: unlike the resolved target, it never changes when an
 *  edit makes some node unreachable (SSL prunes unreachable nodes), so option-set comparisons key on text. */
const textOf = (c: DialogChoice): string => c.text ?? "";
const sortedTexts = (cs: readonly DialogChoice[]): string[] => cs.map((c) => textOf(c)).sort();

/** Every id a choice target names: a resolved `state` (`stateId`) or an `external`/unresolved label. A reference
 *  to a just-deleted or -renamed node reappears here as an `external` label (the parser could not resolve it),
 *  which is exactly the dangling residue the remove/rename invariants below check for. */
function targetId(t: DialogTarget): string | undefined {
    if (t.kind === "state") return t.stateId;
    if (t.kind === "external") return t.label;
    return undefined;
}

/** True if ANY choice anywhere in the model still points at `id` (as a resolved state target or a dangling label). */
function referencesId(m: DialogModel, id: string): boolean {
    return statesOf(m).some((s) => s.choices.some((c) => targetId(c.target) === id));
}

/** The max number of distinct real dialogs each op exercises: enough to be representative, bounded for runtime. */
const SAMPLE = 30;

/**
 * Register the full write-back battery for one family against its real corpus. Each op walks the corpus, edits the
 * first suitable target it finds, applies the family writer, re-parses the produced source, and asserts the op's
 * targeted invariant; it samples up to SAMPLE distinct dialogs and asserts it exercised at least one (so a battery
 * that silently matches nothing fails loudly rather than passing vacuously).
 */
export function defineWritebackCorpus(corpus: FamilyCorpus): void {
    const { family, files, relOf, init, parse, apply } = corpus;

    describe.skipIf(files.length === 0)(`${family} write-back: real corpus (${files.length} files)`, () => {
        const dialogs: Parsed[] = [];
        const unparsed: string[] = [];

        // Parse the whole corpus ONCE, sequentially: the tree-sitter families share a single non-concurrency-safe
        // WASM instance (see ParserManager), so a parallel parse would race it. Files the parser rejects are not
        // this suite's subject and are dropped.
        beforeAll(async () => {
            if (init) await init();
            for (const f of files) {
                const text = readFileSync(f, "utf8");
                try {
                    // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe; sequential by design
                    dialogs.push({ rel: relOf(f), text, model: await parse(text) });
                } catch (error) {
                    unparsed.push(`${relOf(f)}: ${(error as Error).message}`);
                }
            }
        });

        /**
         * Dropping a file the parser rejects is right - it is not this suite's subject - but it may not be
         * silent. Every assertion below filters over `dialogs`, so a parse regression does not turn this
         * suite RED, it makes it greener: the inputs that would have failed stop existing. This is the only
         * check that notices.
         */
        it("parses the whole corpus, so no assertion below is measuring a shrunken sample", () => {
            expect(unparsed, `${unparsed.length} of ${files.length} corpus files failed to parse`).toEqual([]);
        });

        it("re-emitting an unedited model is byte-identical for every real dialog (idempotence)", () => {
            const corrupted = dialogs.filter((d) => apply(d.text, clone(d.model), d.model) !== d.text);
            expect(corrupted.map((d) => d.rel)).toEqual([]);
        });

        it("retarget an option -> the new target lands, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                const node = statesOf(model).find(
                    (s) =>
                        flatEditable(model, s) && s.choices.some((c) => c.target.kind === "state" && retargetable(c)),
                );
                const other = statesOf(model).find((s) => s.id !== node?.id);
                if (!node || !other) continue;
                const opt = node.choices.find(
                    (c) => c.target.kind === "state" && c.target.stateId !== other.id && retargetable(c),
                );
                if (!opt) continue;

                const edited = clone(model);
                setChoiceTarget(statesOf(edited).find((s) => s.id === node.id)!, opt.id, {
                    kind: "state",
                    stateId: other.id,
                });
                const out = apply(text, edited, model);
                expect(out, `${rel}: retarget produced no splice`).not.toBe(text);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                const rOpt = statesOf(re)
                    .find((s) => s.id === node.id)
                    ?.choices.find((c) => c.id === opt.id);
                expect(rOpt?.target, `${rel}: retarget did not land`).toEqual({ kind: "state", stateId: other.id });
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: retarget exercised no dialog`).toBeGreaterThan(0);
        });

        it("remove an option -> that option is gone, siblings intact, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                const node = statesOf(model).find((s) => flatEditable(model, s) && s.choices.length >= 2);
                if (!node) continue;
                const survivorTexts = sortedTexts(node.choices.slice(1));

                const edited = clone(model);
                removeReply(statesOf(edited).find((s) => s.id === node.id)!, node.choices[0]!.id);
                const out = apply(text, edited, model);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                const rNode = statesOf(re).find((s) => s.id === node.id);
                expect(rNode, `${rel}: node vanished on remove-option`).toBeDefined();
                expect(rNode!.choices.length, `${rel}: wrong option count`).toBe(node.choices.length - 1);
                expect(sortedTexts(rNode!.choices), `${rel}: survivors changed`).toEqual(survivorTexts);
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: remove-option exercised no dialog`).toBeGreaterThan(0);
        });

        it("add an option -> one more option, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                const node = statesOf(model).find((s) => flatEditable(model, s));
                if (!node) continue;

                const edited = clone(model);
                const eNode = statesOf(edited).find((s) => s.id === node.id)!;
                const added = addReply(edited, eNode);
                // A non-empty option: the writer DEFERS an empty pending option (no text) until commit - that is
                // webview-only state, not source, so an option with no text would correctly serialize to nothing.
                added.text = "@1";
                setChoiceTarget(eNode, added.id, { kind: "exit" });
                const out = apply(text, edited, model);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                const rNode = statesOf(re).find((s) => s.id === node.id);
                expect(rNode?.choices.length, `${rel}: add-option did not add`).toBe(node.choices.length + 1);
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: add-option exercised no dialog`).toBeGreaterThan(0);
        });

        it("reorder options -> order changes, the option set is preserved, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                // Reordering a CONDITIONAL option (one wrapped in an `if`) is a documented Tier-3 limitation: the
                // SSL writer safely declines it (moving it would rewrite the `if` wrapper) rather than corrupt the
                // source. So the swapped pair must both be flat (unconditional) - the writer's supported scope.
                const node = statesOf(model).find(
                    (s) =>
                        flatEditable(model, s) &&
                        s.choices.length >= 2 &&
                        !s.choices[0]!.condition &&
                        !s.choices[1]!.condition &&
                        textOf(s.choices[0]!) !== textOf(s.choices[1]!),
                );
                if (!node) continue;
                const setTexts = sortedTexts(node.choices);

                const edited = clone(model);
                moveReply(statesOf(edited).find((s) => s.id === node.id)!, node.choices[0]!.id, 1);
                const out = apply(text, edited, model);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                const rNode = statesOf(re).find((s) => s.id === node.id);
                expect(rNode, `${rel}: node vanished on reorder`).toBeDefined();
                expect(sortedTexts(rNode!.choices), `${rel}: reorder changed the option set`).toEqual(setTexts);
                expect(textOf(rNode!.choices[0]!), `${rel}: order did not change`).toBe(textOf(node.choices[1]!));
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: reorder exercised no dialog`).toBeGreaterThan(0);
        });

        it("remove a node -> it is gone, no inbound reference to it dangles, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                const victim = statesOf(model).find((s) => deletableNode(model, s) && referencesId(model, s.id));
                if (!victim) continue;

                const edited = clone(model);
                deleteState(edited, statesOf(edited).find((s) => s.id === victim.id)!);
                const out = apply(text, edited, model);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                expect(
                    statesOf(re).some((s) => s.id === victim.id),
                    `${rel}: deleted node survived`,
                ).toBe(false);
                expect(referencesId(re, victim.id), `${rel}: inbound ref to deleted node dangles`).toBe(false);
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: remove-node exercised no dialog`).toBeGreaterThan(0);
        });

        it("add a node and wire it in -> it exists, is targeted, source re-parses (the double-comma regression)", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                // Wire the new node from a state in the SAME root (a real add: the UI adds a node to the current
                // dialogue and wires it there; a cross-dialogue link is an EXTERN, a different flow). The src must
                // be OPTION-reachable (an entry, or the target of some option) - the SSL parser prunes nodes not
                // reachable through the option graph, so wiring the new node from an out-of-band `call`-only node
                // would leave it correct in source but absent from the reparsed model (nothing to assert against).
                const root = dialogRoot(model);
                const optionReachable = (s: DialogState): boolean =>
                    s.isEntry === true ||
                    statesOf(model).some((o) =>
                        o.choices.some((c) => c.target.kind === "state" && c.target.stateId === s.id),
                    );
                const src = root?.states.find((s) => flatEditable(model, s) && optionReachable(s));
                if (!src || !root) continue;
                const newId = `zz_probe_${family.replaceAll(/\W/g, "")}`;
                if (statesOf(model).some((s) => s.id === newId)) continue;

                const edited = clone(model);
                const eRoot = edited.roots.find((r) => r.id === root.id) ?? dialogRoot(edited)!;
                const node = addState(edited, eRoot, newId);
                node.text = statesOf(model)[0]?.text ?? "@1"; // reuse an existing @N so no id minting is needed here
                const eSrc = statesOf(edited).find((s) => s.id === src.id)!;
                const inbound = addReply(edited, eSrc);
                inbound.text = "@1"; // non-empty: an empty pending option is deferred by the writer (see add-option)
                setChoiceTarget(eSrc, inbound.id, { kind: "state", stateId: newId });

                const out = apply(text, edited, model);
                expect(out, `${rel}: add-node produced no splice`).not.toBe(text);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                expect(
                    statesOf(re).some((s) => s.id === newId),
                    `${rel}: new node absent after re-parse`,
                ).toBe(true);
                const rSrc = statesOf(re).find((s) => s.id === src.id);
                expect(
                    rSrc?.choices.some((c) => c.target.kind === "state" && c.target.stateId === newId),
                    `${rel}: inbound option to new node absent`,
                ).toBe(true);
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: add-node exercised no dialog`).toBeGreaterThan(0);
        });

        it("rename a node -> new id present, old id gone, inbound references retargeted, source re-parses", async () => {
            let exercised = 0;
            for (const { rel, text, model } of dialogs) {
                const node = statesOf(model).find((s) => editableNode(model, s) && referencesId(model, s.id));
                if (!node) continue;
                const newId = `${node.id}_renamed`;
                if (statesOf(model).some((s) => s.id === newId)) continue;

                const edited = clone(model);
                if (!renameState(edited, statesOf(edited).find((s) => s.id === node.id)!, newId)) continue;
                const out = apply(text, edited, model);
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe
                const re = await parse(out);
                expect(
                    statesOf(re).some((s) => s.id === newId),
                    `${rel}: renamed node absent`,
                ).toBe(true);
                expect(
                    statesOf(re).some((s) => s.id === node.id),
                    `${rel}: old id survived rename`,
                ).toBe(false);
                expect(referencesId(re, node.id), `${rel}: inbound ref to old id dangles`).toBe(false);
                if (++exercised >= SAMPLE) break;
            }
            expect(exercised, `${family}: rename exercised no dialog`).toBeGreaterThan(0);
        });
    });
}
