/**
 * Fills in the argument count of every engine function in compilers/ssl/src/int/engine-functions.ts from the
 * signatures in server/data/fallout-ssl-*.yml.
 *
 * The opcode numbers in that file come from the engine's own dispatch order, which says nothing about
 * how many arguments each function takes. The compiler never needed the count - the source supplies the
 * arguments - but the decompiler does: an opcode alone cannot say how many stack values belong to it.
 * The signatures the LSP already maintains are the answer, so this reads them rather than introducing a
 * second description of the same functions.
 *
 * Rewrites entries in place, leaving the hand-verified `popsResult` and `procArgs` fields untouched.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/update-ssl-engine-arity.ts
 */

import fs from "node:fs";
import path from "node:path";
import { loadData } from "./generate-data.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const YAML_SOURCES = ["server/data/fallout-ssl-base.yml", "server/data/fallout-ssl-sfall.yml"];
const TARGET = "compilers/ssl/src/int/engine-functions.ts";

/** Matches one table entry, capturing its name, its opcode expression and any trailing fields. */
const ENTRY = /^(\s+)([a-z_0-9]+): \{ opcode: ([^,}]+?)(, args: \d+)?(, returns: \w+)?(, [^}]*)? \},$/;

interface Signature {
    args: number;
    returns: boolean;
}

/**
 * Argument counts taken from real scripts rather than from the signature data.
 *
 * Every one of these was found by counting call sites across the Restoration Project and comparing
 * them with the documented signature. Four of the entries are documented with no parameter list at
 * all, so the data is merely silent; the other five state a list that shipped code contradicts at every
 * site. The counts here are what the corpus shows, with the number of call sites as the evidence.
 *
 * The signatures themselves are deliberately NOT rewritten to match. A count is all the corpus
 * establishes - it says nothing about what the parameters are called or what they mean - and filling
 * that in from the count alone would turn a gap in the documentation into a plausible-looking
 * invention. Correcting them properly needs a source that describes the functions.
 */
const OBSERVED_ARITY: Readonly<Record<string, { args: number; sites: number }>> = {
    animate_stand_obj: { args: 1, sites: 54 },
    explosion: { args: 3, sites: 379 },
    give_exp_points: { args: 1, sites: 1842 },
    gsay_end: { args: 0, sites: 1377 },
    inven_unwield: { args: 0, sites: 26 },
    kill_critter_type: { args: 2, sites: 85 },
    metarule2_explosions: { args: 3, sites: 72 },
    reg_anim_animate_forever: { args: 2, sites: 37 },
    scr_return: { args: 1, sites: 25 },
};

interface DataItem {
    readonly name: string;
    readonly detail?: string;
    readonly type?: string;
    readonly args?: readonly unknown[];
}

/**
 * Argument count and whether the call yields a value.
 *
 * Two shapes appear in the data: a structured `args` list with a `type`, and a `detail` string holding
 * the C-like declaration. A detail without parentheses is a value rather than a call - `int
 * action_being_used` - and takes none.
 */
function signatureOf(item: DataItem): Signature | undefined {
    const returnType = item.type ?? item.detail?.trimStart().split(/[\s(]/)[0];
    const returns = returnType !== undefined && returnType.toLowerCase() !== "void";
    if (item.args) return { args: item.args.length, returns };
    if (item.detail === undefined) return undefined;

    const parameters = /\(([^)]*)\)/.exec(item.detail);
    // An unterminated parameter list would otherwise read as a no-argument value and quietly emit the
    // wrong count. Three signatures in the data were missing their closing parenthesis when this landed.
    if (!parameters && item.detail.includes("(")) {
        throw new Error(`signature for '${item.name}' has no closing parenthesis: ${item.detail}`);
    }
    if (!parameters) return { args: 0, returns };
    const inner = parameters[1]!.trim();
    return { args: inner === "" || inner.toLowerCase() === "void" ? 0 : inner.split(",").length, returns };
}

function main(): void {
    const data = loadData(YAML_SOURCES.map((file) => path.join(REPO_ROOT, file)));
    const signatures = new Map<string, Signature>();
    for (const stanza of Object.values(data)) {
        for (const item of stanza.items) {
            const signature = signatureOf(item);
            if (signature !== undefined) signatures.set(item.name.toLowerCase(), signature);
        }
    }

    const corrected: string[] = [];
    for (const [name, { args, sites }] of Object.entries(OBSERVED_ARITY)) {
        const documented = signatures.get(name);
        if (documented === undefined) {
            throw new Error(`'${name}' has a corpus-observed arity but no signature to attach it to`);
        }
        if (documented.args === args) {
            throw new Error(`'${name}' no longer disagrees with the data; drop its OBSERVED_ARITY entry`);
        }
        corrected.push(`${name} ${documented.args}->${args} (${sites} call sites)`);
        signatures.set(name, { args, returns: documented.returns });
    }

    const targetPath = path.join(REPO_ROOT, TARGET);
    const lines = fs.readFileSync(targetPath, "utf8").split("\n");
    const unknown: string[] = [];
    const disagreements: string[] = [];
    let filled = 0;

    const updated = lines.map((line) => {
        const match = ENTRY.exec(line);
        if (!match) return line;
        const [, indent, name, opcode] = match;
        const rest = match[6];
        const signature = signatures.get(name!);
        if (signature === undefined) {
            unknown.push(name!);
            return `${indent}${name}: { opcode: ${opcode}${rest ?? ""} },`;
        }
        // `popsResult` is oracle-verified against the reference's own output, so where the documented
        // return type disagrees the data is the suspect. Report rather than overwrite either one.
        if ((rest ?? "").includes("popsResult") && !signature.returns) disagreements.push(name!);
        filled++;
        const returns = signature.returns ? ", returns: true" : "";
        return `${indent}${name}: { opcode: ${opcode}, args: ${signature.args}${returns}${rest ?? ""} },`;
    });

    fs.writeFileSync(targetPath, updated.join("\n"));
    console.log(`${TARGET}: ${filled} entries given a signature, ${unknown.length} without one`);
    if (unknown.length > 0) console.log(`  no signature in the data: ${unknown.join(", ")}`);
    if (corrected.length > 0) console.log(`  arity taken from the corpus instead: ${corrected.join(", ")}`);
    if (disagreements.length > 0) {
        console.log(`  documented as void but the compiler discards a result: ${disagreements.join(", ")}`);
    }
}

main();
