import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { effParser } from "../src/eff";
import { itmParser } from "../src/itm";
import { splParser } from "../src/spl";
import { REPO_ROOT } from "./repo-root";
import type { ParsedField, ParsedGroup } from "../src/types";

const ITM_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const CRE_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/fixpack/iron15.cre");

/** Every field in the display tree, flattened - strrefs sit at several depths (CRE's are header scalars plus
 *  the 100 sound slots, which are array children). */
function allFields(group: ParsedGroup): ParsedField[] {
    const out: ParsedField[] = [];
    for (const child of group.fields) {
        if ("fields" in child) out.push(...allFields(child));
        else out.push(child);
    }
    return out;
}

function parseFields(parser: { parse: (b: Uint8Array) => { root: ParsedGroup } }, fixture: string): ParsedField[] {
    return allFields(parser.parse(new Uint8Array(fs.readFileSync(fixture))).root);
}

const SPL_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl");
const EFF_FIXTURE = path.join(
    REPO_ROOT,
    "external/infinity-engine/Ascension/ascension/ascensionmain/demon/babausu.eff",
);

// A mage with a full spellbook and inventory - the header fixture above carries neither.
const CRE_SPELLS_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");

const haveFixtures = fs.existsSync(ITM_FIXTURE) && fs.existsSync(CRE_FIXTURE);
const have2daFixtures =
    haveFixtures && fs.existsSync(SPL_FIXTURE) && fs.existsSync(EFF_FIXTURE) && fs.existsSync(CRE_SPELLS_FIXTURE);

const isStrref = (f: ParsedField): boolean => f.ref?.kind === "strref";

/** The IDS tables a field declares, or undefined when it declares no IDS ref. */
function idsTables(f: ParsedField): readonly string[] | undefined {
    return f.ref?.kind === "ids" ? f.ref.tables : undefined;
}

// The flag is what tells a consumer holding the game's dialog.tlk which numbers are resolvable, so it has to
// survive the spec -> walk -> display-tree path, not merely exist on the spec.
describe.skipIf(!haveFixtures)("strref fields reach the display tree", () => {
    it("marks all four ITM header strrefs and nothing else", () => {
        const marked = parseFields(itmParser, ITM_FIXTURE).filter((f) => isStrref(f));

        expect(marked.map((f) => f.name)).toEqual([
            "Unidentified Name",
            "Identified Name",
            "Unidentified Desc",
            "Identified Desc",
        ]);
        // Still plain signed numbers - the flag adds resolvability, it does not change how the value is stored
        // or edited (a strref that changed type would break every numeric control and the byte round-trip).
        expect(marked.every((f) => f.type === "int32")).toBe(true);
    });

    it("marks the CRE name strrefs and every sound-set slot", () => {
        const marked = parseFields(creParser, CRE_FIXTURE).filter((f) => isStrref(f));

        // 2 header names + the 100-slot sound-set block, which reaches the tree as array children - the path a
        // per-field spec property is easiest to lose on.
        expect(marked).toHaveLength(102);
        expect(marked.slice(0, 2).map((f) => f.name)).toEqual(["Long Name", "Short Name"]);
    });

    // The library never names these slots itself: the mapping is per-install (BG1 SOUNDOFF.IDS vs BG2
    // SNDSLOT.IDS, plus mod extensions), so it emits which table names the slot and at which index, and a
    // consumer holding the game resolves it. Ordered by preference - SNDSLOT is BG2's, SOUNDOFF is BG1's.
    it("tells a consumer which IDS table names each CRE sound slot", () => {
        const slots = parseFields(creParser, CRE_FIXTURE).filter((f) => f.slotRef !== undefined);
        const sndslot = { kind: "ids", tables: ["SNDSLOT", "SOUNDOFF"] };

        expect(slots).toHaveLength(100);
        expect(slots[0]?.slotRef).toEqual({ ref: sndslot, index: 0 });
        expect(slots[99]?.slotRef).toEqual({ ref: sndslot, index: 99 });
    });

    // A sound slot is BOTH: its value resolves through the TLK and its label through an IDS table. Consumers
    // have to apply both, and a fixture carrying only one property cannot catch a consumer that stops after
    // the first - which is exactly how the pre-migration two-mechanism code dropped the label.
    it("carries value ref and slot ref together on one sound slot", () => {
        const slot = parseFields(creParser, CRE_FIXTURE).find((f) => f.slotRef !== undefined);

        expect(slot?.ref).toEqual({ kind: "strref" });
        expect(slot?.slotRef?.ref).toEqual({ kind: "ids", tables: ["SNDSLOT", "SOUNDOFF"] });
    });

    // Pins the constant `client/src/ie-resources/tree-provider.ts` reads raw for its hover tooltip: it grabs the
    // name strref at a fixed offset rather than parsing a whole record per hover, so if a format ever moved that
    // field the tooltip would silently resolve the wrong string.
    it("keeps the record's name strref at offset 8, where the tree tooltip reads it", () => {
        const itmName = parseFields(itmParser, ITM_FIXTURE).find((f) => isStrref(f));
        const creName = parseFields(creParser, CRE_FIXTURE).find((f) => isStrref(f));

        expect(itmName?.offset).toBe(8);
        expect(creName?.offset).toBe(8);
    });
});

// These values are IDS-backed: the vendored enum is a small baseline (8 races) while the install's own
// RACE.IDS carries 82 and mods extend it further, so the field declares which table names it and a consumer
// holding the game merges that in. Declaring it here is what makes the whole set reachable without the client
// keeping its own field-to-table map.
describe.skipIf(!haveFixtures)("IDS-backed CRE fields declare their table", () => {
    it("declares the naming table for every game-defined header field", () => {
        const declared = parseFields(creParser, CRE_FIXTURE)
            .filter((f) => idsTables(f) !== undefined)
            .map((f) => [f.name, idsTables(f)] as const);

        expect(Object.fromEntries(declared)).toEqual({
            Sex: ["GENDER"],
            Gender: ["GENDER"],
            "Enemy Ally": ["EA"],
            General: ["GENERAL"],
            Specific: ["SPECIFIC"],
            Race: ["RACE"],
            "Racial Enemy": ["RACE"],
            Class: ["CLASS"],
            Alignment: ["ALIGNMEN"],
            Kit: ["KIT"],
            "Animation Id": ["ANIMATE"],
        });
    });

    // KIT.IDS is keyed by the bare kit id while the field stores it in the dword's other half, so the
    // declaration carries the encoding between the two - corpus-verified, see the spec comment.
    it("declares the encoding between KIT.IDS keys and the stored kit dword", () => {
        const kit = parseFields(creParser, CRE_FIXTURE).find((f) => f.name === "Kit");

        expect(kit?.ref).toEqual({ kind: "ids", tables: ["KIT"], keyEncoding: { KIT: "swappedWords" } });
    });

    // Additive, not a replacement: the vendored table stays as the fallback for a record opened outside a game,
    // and the field stays an open enum so a value no table names is still editable.
    it("keeps the vendored table and open-enum behaviour alongside the declaration", () => {
        const race = parseFields(creParser, CRE_FIXTURE).find((f) => f.name === "Race");

        expect(race?.enumOptions?.["1"]).toBe("HUMAN");
        expect(race?.enumOpen).toBe(true);
    });
});

/**
 * The magic school and secondary type are 2DA-backed, and the SAME pair appears in three formats (SPL header,
 * ITM ability, EFF body) through one shared vendored table. Declaring the ref on only some of them would name
 * the value in one editor and not another, so this pins the whole cohort against real parses.
 *
 * The stored value is the 2DA's ROW INDEX and the row NAME is the identifier - MSCHOOL row 1 is ABJURER - so
 * the reader maps index to name (see `archive/two-da.ts`).
 */
describe.skipIf(!have2daFixtures)("2DA-backed school/sectype fields declare their table", () => {
    const refFor = (fields: ParsedField[], name: string): unknown => fields.find((f) => f.name === name)?.ref;
    const school = { kind: "2da", tables: ["MSCHOOL"] };
    const sectype = { kind: "2da", tables: ["MSECTYPE"] };

    it("declares MSCHOOL and MSECTYPE on the ITM ability pair", () => {
        const fields = parseFields(itmParser, ITM_FIXTURE);

        expect(refFor(fields, "Primary Type")).toEqual(school);
        expect(refFor(fields, "Secondary Type")).toEqual(sectype);
    });

    it("declares the same pair on the SPL header", () => {
        const fields = parseFields(splParser, SPL_FIXTURE);

        expect(refFor(fields, "School")).toEqual(school);
        expect(refFor(fields, "Sectype")).toEqual(sectype);
    });

    it("declares the same pair on the EFF body", () => {
        const fields = parseFields(effParser, EFF_FIXTURE);

        expect(refFor(fields, "School")).toEqual(school);
        expect(refFor(fields, "Sectype")).toEqual(sectype);
    });
});

/**
 * The projectile an ability fires is named by TWO tables that key the same value space differently, so the
 * declaration has to carry a per-table encoding - the stored value is the MISSILE.IDS key outright and the
 * PROJECTL.IDS key plus one (IESDP: "in BG2, this value is off-by-one from projectl.ids value").
 *
 * Measured across a real BG:EE and BG2:ToB install: for every value the corpus holds, `MISSILE[v]` and
 * `PROJECTL[v-1]` name the same projectile (stored 2 is Arrow / ARROW, 48 Sparkle_Gold / SPARKLGO), and no
 * PROJECTL key on BG:EE lacks a MISSILE counterpart. Neither table alone suffices across editions, which is
 * why both are declared - see the shared constant's comment.
 *
 * One shared ref for the two ABILITY sites, like the school/sectype pair above: they are one engine concept,
 * and a field named in one editor but not another is the drift a shared declaration prevents. The EFF v2 body
 * field is deliberately NOT that ref - it is the impact projectile, keyed straight into PROJECTL.IDS - and is
 * pinned below precisely because IESDP's projectl.ids page lists all three offsets together and invites the
 * mistake (which this suite caught once already).
 */
describe.skipIf(!have2daFixtures)("projectile fields declare both naming tables and their encodings", () => {
    const projectile = {
        kind: "ids",
        tables: ["PROJECTL", "MISSILE"],
        keyEncoding: { PROJECTL: "keyPlusOne" },
        symbolResource: { table: "PROJECTL", type: "PRO" },
    };

    it("declares it on both ability fields, which are one concept in two formats", () => {
        const itm = parseFields(itmParser, ITM_FIXTURE).find((f) => f.name === "Projectile Animation");
        const spl = parseFields(splParser, SPL_FIXTURE).find((f) => f.name === "Projectile");

        expect(itm?.ref).toEqual(projectile);
        expect(spl?.ref).toEqual(projectile);
    });

    // Near Infinity reads the ability fields through a missile-aware lookup mapping a stored key to PROJECTL
    // key minus one, and reads THIS field as a plain PROJECTL.IDS entry - naming it "Impact projectile", a
    // different field. IESDP states the off-by-one for the ability fields only. Two sources, same answer.
    it("keys the EFF v2 impact projectile straight into PROJECTL, with no missile candidate or offset", () => {
        const eff = parseFields(effParser, EFF_FIXTURE).find((f) => f.name === "Projectile");

        expect(eff?.ref).toEqual({
            kind: "ids",
            tables: ["PROJECTL"],
            symbolResource: { table: "PROJECTL", type: "PRO" },
        });
    });

    // PROJECTL's symbols ARE `.PRO` basenames, so the value identifies a real resource and earns the same open
    // chip a resref field gets. Declared against PROJECTL by name, never the whole ref: MISSILE sits beside it
    // in the ability declaration and its symbols are labels with no file behind them.
    it("pairs the projectile value with the .PRO its PROJECTL symbol names, on PROJECTL only", () => {
        const itm = parseFields(itmParser, ITM_FIXTURE).find((f) => f.name === "Projectile Animation");

        const decl = itm?.ref?.kind === "ids" ? itm.ref.symbolResource : undefined;
        expect(decl).toEqual({ table: "PROJECTL", type: "PRO" });
    });

    // The encoding is per TABLE, not per declaration: the same ref names one candidate directly and the other
    // at an offset. A single whole-declaration encoding - what CRE `kit` carries - cannot express that, which
    // is what kept these three fields undeclared.
    it("encodes only the offset table, leaving the directly-keyed one alone", () => {
        const spl = parseFields(splParser, SPL_FIXTURE).find((f) => f.name === "Projectile");

        const encodings = spl?.ref?.kind === "ids" ? spl.ref.keyEncoding : undefined;
        expect(encodings?.["MISSILE"]).toBeUndefined();
        expect(encodings?.["PROJECTL"]).toBe("keyPlusOne");
    });

    /**
     * The two values below both tables' key space are vendored, because no install can name them: PROJECTL
     * would need a key -1 or 0, and MISSILE.IDS starts at 1 on both a real BG:EE and a BG2:ToB. Measured
     * there: stored 0 occurs in 99 of ToB's 1845 item abilities and read bare, and stored 1 - the DOMINANT
     * value at 1529 of those and 2300 of 3683 spell abilities - is only named because MISSILE happens to ship.
     *
     * Kept to exactly those two keys. The projectiles themselves stay un-vendored (see PROJECTILE_REF), so a
     * table growing past {0, 1} would be the closed list that declaration refuses to carry.
     */
    it("vendors the two values below the tables' key space, and only those", () => {
        const itm = parseFields(itmParser, ITM_FIXTURE).find((f) => f.name === "Projectile Animation");
        const spl = parseFields(splParser, SPL_FIXTURE).find((f) => f.name === "Projectile");

        expect(itm?.enumOptions).toEqual({ "0": "None", "1": "None" });
        expect(spl?.enumOptions).toEqual(itm?.enumOptions);
        // Open, or the vendored pair would read as the field's whole domain the moment no game is attached.
        expect(itm?.enumOpen).toBe(true);
        expect(spl?.enumOpen).toBe(true);
    });

    // NOT on the impact projectile: that field is keyed straight into PROJECTL, so its stored 1 is ARROW, a
    // real projectile. Copying the ability pair onto it would relabel a projectile as "None".
    it("leaves the impact projectile unvendored, whose 1 is a real PROJECTL entry", () => {
        const eff = parseFields(effParser, EFF_FIXTURE).find((f) => f.name === "Projectile");

        expect(eff?.enumOptions).toBeUndefined();
    });
});

/**
 * Resref fields declare what KIND of resource they point at, so a consumer holding the game can offer to open
 * it. Hand-declared, never generated: IESDP records the target only in prose and inconsistently - the same
 * ground-icon field reads "Ground icon (BAM)" in ITM and plain "Ground icon" in SPL, and others say only
 * "Resource".
 *
 * The target type is ONE type, not a candidate list to probe: which resource a record points at follows from
 * the record's own version and the game, both of which are known - so a field that genuinely differs names the
 * exception per flavour (`byFlavour`) rather than leaving the install to disambiguate by what happens to exist.
 *
 * The pins below are the whole declared set per format - so a field that should NOT carry one (the char[2]
 * item animation code, a char[32] script variable, the opcode-dependent effect resources) failing to be
 * excluded shows up here too.
 */
describe.skipIf(!have2daFixtures)("resref fields declare their target resource type", () => {
    /** `TYPE` for a fixed target, `TYPE (flavour:OTHER)` where a flavour stores something else. */
    function declared(fields: ParsedField[]): Record<string, string> {
        const out: Record<string, string> = {};
        for (const f of fields) {
            if (f.ref?.kind !== "resource") continue;
            const overrides = Object.entries(f.ref.byFlavour ?? {});
            out[f.name] =
                overrides.length === 0
                    ? f.ref.type
                    : `${f.ref.type} (${overrides.map(([g, t]) => `${g}:${t}`).join(" ")})`;
        }
        return out;
    }

    it("declares the ITM icons, and the flavour-dependent replacement", () => {
        expect(declared(parseFields(itmParser, ITM_FIXTURE))).toEqual({
            Replacement: "ITM (pstee:WAV)",
            "Inventory Icon": "BAM",
            "Ground Icon": "BAM",
            "Description Icon": "BAM",
            "Use Icon": "BAM",
        });
    });

    // The two `unused` SPL resrefs stay undeclared: IESDP marks them unused and they name nothing.
    it("declares the SPL sound and icons", () => {
        expect(declared(parseFields(splParser, SPL_FIXTURE))).toEqual({
            "Completion Sound": "WAV",
            "Spellbook Icon": "BAM",
            "Memorised Icon": "BAM",
        });
    });

    it("declares the CRE portraits, scripts, dialog, spells and items", () => {
        expect(declared(parseFields(creParser, CRE_SPELLS_FIXTURE))).toEqual({
            "Small Portrait": "BMP",
            "Large Portrait": "BMP (pstee:BAM)",
            "Script Override": "BCS",
            "Script Class": "BCS",
            "Script Race": "BCS",
            "Script General": "BCS",
            "Script Default": "BCS",
            "Dialog File": "DLG",
            Spell: "SPL",
            Item: "ITM",
        });
    });
});

/**
 * A resref whose target type is chosen by another field's value cannot be declared as a type, and leaving it
 * bare is indistinguishable from nobody having got to it. It carries an explicit deferral instead, so the
 * absence is a recorded decision that a completeness sweep can read.
 *
 * Every effect resource is one: the opcode decides what it points at (a CRE for opcode 55, a spell for 146, a
 * 2DA for 175...), so no single type is right for the field.
 */
describe.skipIf(!have2daFixtures)("resrefs whose type depends on another field are deferred, not bare", () => {
    const deferredNames = (fields: ParsedField[]): string[] =>
        fields.filter((f) => f.ref?.kind === "deferred").map((f) => f.name);

    it("marks every EFF v2 resource field", () => {
        expect(deferredNames(parseFields(effParser, EFF_FIXTURE))).toEqual([
            "Resource",
            "Resource2",
            "Resource3",
            "Parent Resource",
        ]);
    });

    // The 48-byte feature block is shared, so ITM/SPL/CRE effects inherit the same deferral.
    it("marks the shared feature block's resource, reached through an ITM effect", () => {
        expect(deferredNames(parseFields(itmParser, ITM_FIXTURE))).toEqual(["Resource"]);
    });
});
