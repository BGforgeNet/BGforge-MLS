/**
 * Reads a directory of IDS tables into the naming both directions of the codec ask for.
 *
 * One reader for both, so a round trip resolves names from ONE read of the tables: two readers would let a
 * misparse cancel itself out and pass. Parsed here rather than through the reader in `@bgforge/binary`,
 * because the codec depends on no other package - and a misparse cannot hide a defect, since it feeds both
 * sides and shows up as a divergence.
 */

import fs from "node:fs";
import path from "node:path";
import { compileSymbolsFrom, type BcsCompileSymbols, type BcsSymbols } from "@bgforge/bcs";

/** A table row's value: `0x400F` and `30` both occur, in the same file. */
function value(text: string): number {
    return /^-?0x/i.test(text) ? Number.parseInt(text, 16) : Number(text);
}

/**
 * One table's rows. A signature spells its table however it likes - `I:Spell*Spell` names SPELL.IDS - and an
 * install ships the files in whichever case it pleases, so both spellings are tried.
 */
function readTable(dir: string, name: string): [number, string][] {
    for (const spelling of [name.toUpperCase(), name.toLowerCase()]) {
        const file = path.join(dir, `${spelling}.ids`);
        if (!fs.existsSync(file)) continue;
        return fs
            .readFileSync(file, "latin1")
            .split("\n")
            .map((line) => /^\s*(\S+)\s+(\S.*?)\s*$/.exec(line))
            .filter((match): match is RegExpExecArray => match !== null && Number.isInteger(value(match[1]!)))
            .map((match) => [value(match[1]!), match[2]!]);
    }
    return [];
}

export interface IdsTables {
    symbols: BcsSymbols;
    compileSymbols: BcsCompileSymbols;
}

export function readIdsTables(dir: string): IdsTables {
    const byId = (name: string): Map<number, string[]> => {
        const rows = new Map<number, string[]>();
        for (const [id, signature] of readTable(dir, name)) rows.set(id, [...(rows.get(id) ?? []), signature]);
        return rows;
    };

    const triggers = byId("TRIGGER");
    const actions = byId("ACTION");
    // Each enumerated table read once. A script resolves the same handful of them thousands of times.
    const enumerated = new Map<string, ReadonlyMap<number, string> | undefined>();

    const ids = (table: string): ReadonlyMap<number, string> | undefined => {
        const key = table.toUpperCase();
        if (!enumerated.has(key)) {
            const rows = readTable(dir, table);
            // The LAST row wins where a table names one value twice, which is what the decompiler's own
            // reading of a repeated value does.
            enumerated.set(key, rows.length === 0 ? undefined : new Map(rows));
        }
        return enumerated.get(key);
    };
    const enumeratedAll = new Map<string, ReadonlyMap<number, readonly string[]> | undefined>();
    const idsAll = (table: string): ReadonlyMap<number, readonly string[]> | undefined => {
        const key = table.toUpperCase();
        if (!enumeratedAll.has(key)) {
            const grouped = new Map<number, string[]>();
            for (const [id, name] of readTable(dir, table)) grouped.set(id, [...(grouped.get(id) ?? []), name]);
            enumeratedAll.set(key, grouped.size === 0 ? undefined : grouped);
        }
        return enumeratedAll.get(key);
    };

    return {
        symbols: {
            trigger: (id) => triggers.get(id) ?? [],
            action: (id) => actions.get(id) ?? [],
            ids,
        },
        // The codec's own grouping, not a second hand-rolled name index - compileSymbolsFrom already turns
        // idsAll into triggerByName/actionByName, and re-deriving that here risked disagreeing with it.
        compileSymbols: compileSymbolsFrom({ idsAll }),
    };
}
