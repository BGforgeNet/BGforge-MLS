// Shared test fixture: parse the vendored ITM sample through the editor's own
// openSession so the relationship-model tests run against the REAL display tree
// (humanized field labels like "Opcode"/"Parameter1", enum fields whose numeric
// code lives in rawValue). A synthetic hand-built tree diverges from walkStruct
// output and would not catch label/rawValue mismatches.
//
// Not a *.test.ts file, so vitest does not collect it as a suite.

import fs from "node:fs";
import path from "node:path";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import type { FlatNode, Model } from "../src/model";

export const ITM_FIXTURE = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");

export function itmFixturePresent(): boolean {
    return fs.existsSync(ITM_FIXTURE);
}

/** Parse the ITM sample into a fresh editor session (real parser, real display tree). */
export function openItmSession(): EditorSession {
    const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
    const { sessionId } = openSession("file:///fixture.itm", bytes);
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("ITM fixture did not open");
    return session;
}

function norm(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/** The field child nodes of the first effect, keyed by normalized field name
 *  (e.g. "opcode", "parameter1", "probability1"). */
export function firstEffectFields(model: Model): Map<string, FlatNode> {
    const effects = model.nodes.find((n) => n.kind === "group" && n.name === "Effects");
    if (!effects) throw new Error("no Effects group in ITM fixture");
    const effectGroups = (model.childrenByParent.get(effects.id) ?? []).map((i) => model.nodes[i]!);
    const eff1 = effectGroups.find((n) => n.kind === "group");
    if (!eff1) throw new Error("no effect entries in ITM fixture");
    const fields = (model.childrenByParent.get(eff1.id) ?? []).map((i) => model.nodes[i]!);
    const map = new Map<string, FlatNode>();
    for (const f of fields) if (f.kind === "field") map.set(norm(f.name), f);
    return map;
}

/** Overwrite the numeric code (rawValue) of a field's parse source - used to drive
 *  an effect to a chosen opcode/probability for a controlled assertion. */
export function setRaw(node: FlatNode, value: number): void {
    (node.source as { value?: unknown; rawValue?: unknown }).rawValue = value;
    (node.source as { value?: unknown; rawValue?: unknown }).value = value;
}
