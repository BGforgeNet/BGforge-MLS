import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decompileBcs, readBcs, writeBcs, type BcsSymbols } from "@bgforge/bcs";

/**
 * Differential against the reference implementation, reproducible on any checkout.
 *
 * `corpus.test.ts` sweeps a real install and can only run where one exists, and it gates the ROUND TRIP -
 * nothing there checks that a decompiled script says what the reference says. This does, and it needs no
 * game: WeiDU compiles the committed `.baf` sources itself, against the committed IDS tables beside them,
 * then decompiles its own output. Both sides read the same tables, so a divergence is the decompiler's.
 *
 * The tables are hand-written and hold ONLY the rows these fixtures use, copied verbatim from a stock
 * BG:EE's own - a signature invented here would prove the decompiler agrees with a fiction. That is also
 * why the sources are compiled rather than committed as `.bcs`: a fixture written by hand encodes what its
 * author believed the compiler does, and the point of a differential is not to assume that.
 *
 * The fixtures exist to carry the rules the install sweep found and the format spec does not state, listed
 * in `coverage` below. Losing one has to fail rather than quietly shrink the differential.
 */
const FIXTURE_DIR = path.join(__dirname, "fixtures", "differential");
const IDS_DIR = path.join(FIXTURE_DIR, "ids");
const WEIDU_TIMEOUT_MS = 60_000;

/**
 * `scripts/ensure-weidu.sh` exports WEIDU_BIN - the host's own WeiDU, or the pinned one it downloads.
 *
 * Skipping without one is safe rather than a hole, but only because the harness resolves a binary BEFORE
 * the unit phase this suite runs in (`scripts/test.sh`), and CI puts one on PATH. A bare `vitest run` in
 * this package is the only context that skips, and there the differential is not what is being asked for.
 */
const WEIDU = process.env.WEIDU_BIN ?? "weidu";

function weiduAvailable(): boolean {
    try {
        execFileSync(WEIDU, ["--version"], { timeout: WEIDU_TIMEOUT_MS, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const available = weiduAvailable();
const SOURCES = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".baf"))
    .sort();

/**
 * The fixture tables, parsed here rather than through the reader in `@bgforge/binary`.
 *
 * The codec package depends on nothing on purpose, and these files are a handful of plain LF rows - none of
 * what that reader exists for (encryption, CRLF, malformed rows, a table shipped by a mod) is in play. A
 * misparse here cannot hide a defect either: it would feed OUR side alone and show up as a divergence.
 */
function readTable(name: string): string[][] {
    // Upper-cased because a signature spells its table however it likes - `I:Spell*Spell` names SPELL.IDS -
    // and a real install resolves a resource by name without regard to case.
    const file = path.join(IDS_DIR, `${name.toUpperCase()}.ids`);
    if (!fs.existsSync(file)) return [];
    return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line) => /^\s*(\S+)\s+(\S.*?)\s*$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null && Number.isInteger(Number(match[1])))
        .map((match) => [match[1]!, match[2]!]);
}

function rowsById(name: string): Map<number, string[]> {
    const table = new Map<number, string[]>();
    for (const [value, identifier] of readTable(name)) {
        const key = Number(value);
        table.set(key, [...(table.get(key) ?? []), identifier!]);
    }
    return table;
}

const TRIGGERS = rowsById("TRIGGER");
const ACTIONS = rowsById("ACTION");

const SYMBOLS: BcsSymbols = {
    trigger: (id) => TRIGGERS.get(id) ?? [],
    action: (id) => ACTIONS.get(id) ?? [],
    ids: (table) => {
        const rows = readTable(table);
        return rows.length === 0 ? undefined : new Map(rows.map(([value, name]) => [Number(value), name!]));
    },
};

/** WeiDU appends `// <strref text>` and resref echoes; the emitter deliberately emits none. */
function significantLines(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s*\/\/.*$/, "").replace(/\s+$/, ""))
        .filter((line) => line !== "");
}

let compiled = "";
let decompiled = "";

/** Runs WeiDU over every file of one extension in `dir`, writing its output beside them. */
function runWeidu(dir: string, extension: string): void {
    const inputs = fs.readdirSync(dir).filter((name) => name.endsWith(extension));
    execFileSync(WEIDU, ["--nogame", "--search-ids", IDS_DIR, "--out", ".", ...inputs], {
        cwd: dir,
        timeout: WEIDU_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

describe.skipIf(!available)("decompileBcs - differential against the reference implementation", () => {
    beforeAll(() => {
        compiled = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-diff-"));
        for (const name of SOURCES) fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(compiled, name));
        runWeidu(compiled, ".baf");

        // A second directory, because decompiling writes `<name>.baf` over the source it was built from.
        decompiled = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-diff-"));
        for (const name of SOURCES) {
            const script = name.replace(/\.baf$/, ".bcs");
            fs.copyFileSync(path.join(compiled, script), path.join(decompiled, script));
        }
        runWeidu(decompiled, ".bcs");
    });

    afterAll(() => {
        for (const dir of [compiled, decompiled]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    const stored = (name: string): string =>
        fs.readFileSync(path.join(compiled, name.replace(/\.baf$/, ".bcs")), "latin1");

    test.each(SOURCES)("%s decompiles to exactly what the reference emits", (name) => {
        const reference = fs.readFileSync(path.join(decompiled, name), "latin1");

        const ours = decompileBcs(readBcs(stored(name)), SYMBOLS);

        expect(significantLines(ours)).toEqual(significantLines(reference));
    });

    // The reference's own output is an independent producer, so this is not the codec agreeing with itself.
    test.each(SOURCES)("%s re-emits byte-identically", (name) => {
        const text = stored(name);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    /**
     * What the fixtures are for. Each entry is a rule the corpus differential established that the format
     * spec does not state, so a fixture edited until it no longer carries its rule has to fail here rather
     * than leave the rule unguarded.
     */
    test("the fixtures still carry every rule this differential exists to guard", () => {
        const emitted = SOURCES.map((name) => decompileBcs(readBcs(stored(name)), SYMBOLS)).join("\n");

        const coverage = {
            // An action's stored first object is an acting-object override, not an argument.
            actionOverride: /ActionOverride\(/.test(emitted),
            // A `NextTriggerObject` record folds into the trigger after it...
            triggerOverride: /TriggerOverride\(/.test(emitted),
            // ...and the folded pair spends ONE slot of an enclosing OR, which is what puts three lines
            // under `OR(3)` when four records precede them.
            triggerOverrideInsideOr: /OR\(3\)\n {4}TriggerOverride\(.*\n {4}False\(\)\n {4}False\(\)/.test(emitted),
            // A zero enumerated field prints as `0`, never as whatever the table happens to name 0.
            zeroEnumeratedField: /\[PC\.0\.ELF\]/.test(emitted),
            // An object with nothing set at all, which no IDS table has a key for.
            anyone: /\[ANYONE\]/.test(emitted),
            // Identifier slots wrap outward, and they nest.
            nestedIdentifiers: /NearestEnemyOf\(LastSeenBy\)/.test(emitted),
            // The fifth stored number of a trigger is a third integer argument, not "unknown".
            thirdIntegerArgument: /NearLocation\(Player1,610,223,20\)/.test(emitted),
            // Two strings packed into one stored slot, an `Area` of six characters then a `Name`.
            packedAreaAndName: /Global\("chapter","GLOBAL",3\)/.test(emitted),
            // One id, two rows taking different argument types; the record decides which was written.
            signatureChosenByRecord: /ApplySpellRES\("SPWI112",Myself\)/.test(emitted) && /ApplySpell\(/.test(emitted),
            // An enumerated argument named through the table its signature points at.
            enumeratedArgument: /WIZARD_MAGIC_MISSILE/.test(emitted),
            // A point argument, which an action stores as two of its plain numbers.
            pointArgument: /MoveToPoint\(\[640\.480\]\)/.test(emitted),
            // An object named by its script name alone, which is how most records name a specific creature.
            objectNamedByString: /Attack\("Druid3"\)/.test(emitted),
            negatedTrigger: /^\s*!HPGT\(/m.test(emitted),
        };

        expect(
            Object.entries(coverage)
                .filter(([, covered]) => !covered)
                .map(([rule]) => rule),
        ).toEqual([]);
    });
});
