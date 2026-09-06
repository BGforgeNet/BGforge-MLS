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
import { drawnArmourLevels, setMembers } from "../../src/set-stances";
import { layerLabel } from "../../src/animation-schemes/layers";

const [gameDir, verb, ...args] = process.argv.slice(2);
if (gameDir === undefined || verb === undefined) {
    process.stderr.write("usage: anim-probe <gameDir> <set|members|ini|exists|files> <arg>...\n");
    process.exit(2);
}

const game = openGame(gameDir);
if (game === undefined) throw new Error(`no Infinity Engine install at ${gameDir}`);
const exists = (resref: string): boolean => game.canRead(resref, "bam");

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
