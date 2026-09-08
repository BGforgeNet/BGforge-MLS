#!/usr/bin/env tsx
/**
 * Ask an installed game one question about its animations, through the same index and resolvers the
 * gallery uses.
 *
 * The sibling of `pnpm lsp-probe` and `pnpm ssl-diff`: the cheapest tool that answers "what does this
 * install actually say about animation X". Without one, every such question became a throwaway script, and
 * a throwaway script re-derives the resolution rules rather than exercising them - so it can disagree with
 * the panel and still look authoritative.
 *
 * Usage:
 *   pnpm anim-probe <gameDir> set <id|name>...     what the index resolved: section, layout, prefixes
 *   pnpm anim-probe <gameDir> members <id|name>... the files each set draws, per armour level
 *   pnpm anim-probe <gameDir> cycles <id|name>...  how many frames each stance's cycles hold, per band
 *   pnpm anim-probe <gameDir> ini <id>...          the animation's own declaration, verbatim fields
 *   pnpm anim-probe <gameDir> exists <resref>...   whether the archive holds these BAMs
 *   pnpm anim-probe <gameDir> files <prefix>       every BAM whose name starts with the prefix
 *
 * An id is hex with or without `0x`; a name is matched against `ANIMATE.IDS`/`ANISND.IDS`, case-insensitively.
 *
 * Lives under `animation/test/` for the same reason the table generator does: it reads an archive through
 * `@bgforge/binary`, which only this package's config resolves to source.
 */

import { openGame } from "../../../binary/src/index";
import { parseAnimationIni } from "../../src/animation-ini";
import { buildAnimationIndex, animationIdHex, setTitle, type AnimationSet } from "../../src/animation-index";
import { tableForFlavour } from "../../src/animation-tables";
import { drawnArmourLevels, setMembers, setStances, stanceIo } from "../../src/set-stances";
import { layerLabel } from "../../src/animation-schemes/layers";
import { mergeParts, type PartTables } from "../../src/animation-schemes/part-tables";
import { readBamV1Tables } from "@bgforge/image";
import type { SequenceShape } from "@bgforge/image/ie-direction";

const [gameDir, verb, ...args] = process.argv.slice(2);
if (gameDir === undefined || verb === undefined) {
    process.stderr.write("usage: anim-probe <gameDir> <set|members|cycles|ini|exists|files> <arg>...\n");
    process.exit(2);
}

const game = openGame(gameDir);
if (game === undefined) throw new Error(`no Infinity Engine install at ${gameDir}`);
// The same reader the gallery draws through, so "this member is missing" means here what it means there.
const io = stanceIo(game);
const exists = io.exists;

/** A member's cycle table, merged across the files it draws from - the reading the band reader takes. */
function mergedCycles(parts: readonly string[]): { sequences: SequenceShape[]; holdsArt: boolean[] } {
    const tables: PartTables[] = [];
    for (const resref of parts) {
        const bytes = io.read(resref);
        if (bytes === undefined) continue;
        try {
            tables.push(readBamV1Tables(bytes));
        } catch {
            // One unreadable part is a lost piece, not a dead row - the posture setStances takes too.
        }
    }
    const merged = mergeParts(tables);
    return { sequences: merged?.sequences ?? [], holdsArt: merged?.holdsArt ?? [] };
}

/** Built once and only where a verb needs it: indexing an install parses every declaration it ships. */
let cached: AnimationSet[] | undefined;
function index(): AnimationSet[] {
    cached ??= buildAnimationIndex(game, tableForFlavour(game.identity.flavour));
    return cached;
}

/** A set by id (hex, `0x` optional) or by either of the names its install declares. */
function resolve(token: string): AnimationSet[] {
    const id = Number.parseInt(token.replace(/^0x/i, ""), 16);
    const wanted = token.toUpperCase();
    return index().filter(
        (set) => set.id === id || set.name.toUpperCase() === wanted || set.code.toUpperCase() === wanted,
    );
}

function describe(set: AnimationSet): void {
    console.log(`${animationIdHex(set.id)} ${setTitle(set)}`);
    console.log(`  section=${set.section ?? "-"} layout=${set.layout ?? "-"} scheme=${set.scheme.kind}`);
    console.log(`  bandStride=${set.bandStride ?? "-"} coarseBands=${set.coarseBands === true}`);
    const prefixes = [...set.prefixByArmour].map(([level, prefix]) => `${level}:${prefix}`).join(" ");
    console.log(`  prefixes=[${prefixes}] base=${set.basePrefix ?? "-"} paperdoll=${set.paperdollPrefix ?? "-"}`);
    if (set.layerPrefixes !== undefined) {
        console.log(`  layers=[${set.layerPrefixes.join(" ")}] labelled "${layerLabel(set.section) ?? "-"}"`);
    }
    console.log(`  draws at armour levels: [${drawnArmourLevels(set, exists).join(" ") || "none"}]`);
}

switch (verb) {
    case "set": {
        for (const token of args) {
            const found = resolve(token);
            if (found.length === 0) console.log(`${token}: no such set in this install`);
            for (const set of found) describe(set);
        }
        break;
    }
    case "members": {
        for (const token of args) {
            for (const set of resolve(token)) {
                console.log(`${animationIdHex(set.id)} ${setTitle(set)}`);
                for (const level of drawnArmourLevels(set, exists)) {
                    console.log(`  armour ${level}:`);
                    for (const member of setMembers(set, level, exists)) {
                        console.log(`    ${member.label.padEnd(28)} ${member.parts.join(" ")}`);
                    }
                }
            }
        }
        break;
    }
    case "cycles": {
        for (const token of args) {
            for (const set of resolve(token)) {
                console.log(`${animationIdHex(set.id)} ${setTitle(set)}`);
                for (const level of drawnArmourLevels(set, exists)) {
                    console.log(`  armour ${level}:`);
                    const stances = setStances(set, level, io);
                    for (const member of setMembers(set, level, exists)) {
                        const { sequences, holdsArt } = mergedCycles(member.parts);
                        const files = member.parts.join("+");
                        console.log(`    ${member.label.padEnd(24)} ${files}  ${sequences.length} cycles`);
                        const banded = new Set<number>();
                        for (const stance of stances.filter((row) => row.resref === member.resref)) {
                            const at = stance.slots.map((slot) => slot.seqIndex);
                            for (const cycle of at) banded.add(cycle);
                            const frames = stance.slots
                                .map((slot) => `${slot.facing}:${sequences[slot.seqIndex]?.frameRefs.length ?? 0}`)
                                .join(" ");
                            const range = at.length === 0 ? "-" : `${Math.min(...at)}-${Math.max(...at)}`;
                            console.log(
                                `      band ${stance.band} ${stance.label.padEnd(28)} cycles ${range.padEnd(7)} ${frames}`,
                            );
                        }
                        // Most files this addresses no stance to are carrying the band skeleton their family
                        // forces on every member, so the count alone is the honest line; only a cycle that
                        // DRAWS out there is worth reading, and it means a picture the panel cannot reach.
                        const loose = sequences.map((_, cycle) => cycle).filter((cycle) => !banded.has(cycle));
                        const drawn = loose.filter((cycle) => holdsArt[cycle] === true);
                        if (loose.length > 0) {
                            const listed = drawn.map((cycle) => `${cycle}:${sequences[cycle]?.frameRefs.length ?? 0}`);
                            const detail = drawn.length === 0 ? "" : `: ${listed.join(" ")}`;
                            console.log(
                                `      outside its bands  ${loose.length} cycles, ${drawn.length} holding art${detail}`,
                            );
                        }
                    }
                }
            }
        }
        break;
    }
    case "ini": {
        for (const token of args) {
            const resref = token.replace(/^0x/i, "").toUpperCase().padStart(4, "0");
            if (!game.canRead(resref, "ini")) {
                console.log(`${resref}: this install declares no INI`);
                continue;
            }
            const ini = parseAnimationIni(game.read(resref, "ini"));
            console.log(`${resref}: ${JSON.stringify(ini, undefined, 2)}`);
        }
        break;
    }
    case "exists": {
        for (const resref of args) console.log(`${resref.padEnd(12)} ${exists(resref)}`);
        break;
    }
    case "files": {
        const prefix = (args[0] ?? "").toUpperCase();
        const names = game
            .list()
            .filter((ref) => ref.ext?.toLowerCase() === "bam")
            .map((ref) => ref.resref.toUpperCase())
            .filter((name) => name.startsWith(prefix))
            .sort();
        console.log(names.join(" "));
        console.log(`${names.length} files`);
        break;
    }
    default:
        process.stderr.write(`unknown verb '${verb}'\n`);
        process.exit(2);
}
