/**
 * Extracts opcode-number -> name mapping from IESDP `_opcodes/op<NNN>.html`
 * frontmatter and emits a generated TS lookup table.
 *
 * IESDP writes one page per engine reading of an opcode - `opNNN.html` and
 * `opNNN-<engine>.html` alike, each carrying the availability matrix that says
 * which engines it speaks for. The unsuffixed filename is NOT a neutral or
 * primary definition; see `ENGINE_PREFERENCE` for which reading these tables
 * describe and why one has to be chosen.
 */

import fs from "node:fs";
import path from "node:path";
import { OpcodeRelationshipOverrides } from "./opcode-relationships.overrides.ts";
import { OpcodeResourceOverrides } from "./opcode-resources.overrides.ts";

/** One opcode-dependent field's display data: what to call it, and the values it is known to take. */
export interface OpcodeSlot {
    label?: string;
    enum?: Readonly<Record<number, string>>;
}

/**
 * The effect fields whose meaning the opcode selects, keyed by the IESDP frontmatter key that names them.
 * `param1`/`param2` exist on every effect record; the rest are EE-era additions IESDP documents for a
 * minority of opcodes. Kept as one list so a new slot reaches harvest, merge and emit by being named here.
 */
export const OPCODE_SLOT_KEYS = [
    "param1",
    "param2",
    "param3",
    "param4",
    "param5",
    "special",
    "savingthrow",
    "power",
] as const;

export type OpcodeSlotKey = (typeof OPCODE_SLOT_KEYS)[number];

export type OpcodeRelationship = Partial<Record<OpcodeSlotKey, OpcodeSlot>> & {
    /** IESDP `opname` - what this engine calls the opcode. */
    name?: string;
    /** The engines this reading applies to, unioned from the pages behind it. */
    engines?: readonly string[];
    /**
     * Curated entries only: the reading this was transcribed from, as its IESDP `opname`. Required whenever
     * the opcode has more than one reading - see `readingFor`. Never emitted; `name` carries it downstream.
     */
    reading?: string;
    availability?: Readonly<Record<string, boolean>>;
    /**
     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's stored
     * value -> the candidate tables that value names, most preferred first (the same first-present-wins
     * ordering `ExternalRef`'s `tables` uses, since editions disagree - ALIGN vs ALIGNMEN).
     *
     * Not harvested: IESDP writes this list several different ways across the opcodes that have it, and the
     * mapping is not shared between them (opcode 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2
     * is OBJECT rather than EA). Curated in the overrides file, per opcode, against each op<NNN>.html.
     */
    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;
    /**
     * What the effect's `resource` resref points at for this opcode, as a resource-type extension. Curated in
     * `opcode-resources.overrides.ts`; IESDP records it only in prose, so it cannot be harvested.
     */
    resourceType?: string;
};

const ENGINE_KEYS = ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"] as const;

/**
 * The engine whose reading of an opcode the generated tables describe, most preferred first.
 *
 * There is no engine-neutral definition to fall back on. An opcode number means whatever each engine makes it
 * mean - often the same thing, sometimes not: 238 is "Stat: Save vs. all" on Icewind Dale and "Death:
 * Disintegrate" on BG2/EE, 283 is "Text: Float Text" against "Use EFF File (Cursed)". IESDP writes one page
 * per reading and the availability matrix on each page says which engines it speaks for; the unsuffixed
 * `opNNN.html` filename carries no special authority (`op025.html` covers BG2 alone, `op283.html` Icewind
 * Dale alone), so selecting by filename picked an arbitrary engine's meaning and applied it to every record.
 *
 * The editor has one flat table and no game to ask at parse time, so it needs one reading: BG(2)EE, being the
 * edition most installs run. Where no page covers an EE engine, the rest of this order picks the next.
 */
const ENGINE_PREFERENCE = ["bgee", "pstee", "bg2", "bg1", "iwd2", "iwd1", "pst"] as const;

/** One IESDP page: which engines its reading covers, per its own frontmatter. */
interface OpcodePage {
    file: string;
    engines: ReadonlySet<string>;
}

/**
 * Rank a page by the most-preferred engine it covers. A page whose matrix marks nothing (a handful do) sorts
 * last rather than being dropped - it is still the only description some opcode has.
 */
function pageRank(page: OpcodePage): number {
    const i = ENGINE_PREFERENCE.findIndex((e) => page.engines.has(e));
    return i === -1 ? ENGINE_PREFERENCE.length : i;
}

/**
 * Every page documenting one opcode, the preferred engine's reading first.
 *
 * Coverage matters as much as the ordering: 137 of the 442 documented opcodes have no unsuffixed page at all -
 * every EE opcode (318-383), every IWD2 opcode (400-457), and 13 others including 177 "Use EFF File", the most
 * common effect opcode in a real install. Reading unsuffixed files only dropped all of them from both
 * generated tables, so those opcodes rendered as a bare number with no name and no parameter labels.
 */
function pagesForOpcode(opcodesDir: string): ReadonlyMap<number, readonly OpcodePage[]> {
    const byOpcode = new Map<number, OpcodePage[]>();
    for (const entry of fs.readdirSync(opcodesDir)) {
        const m = /^op(\d+)(?:-[a-z0-9-]+)?\.html$/.exec(entry);
        if (!m) continue;
        const n = Number.parseInt(m[1]!, 10);
        const file = path.join(opcodesDir, entry);
        const fm = parseRelationshipFrontmatter(fs.readFileSync(file, "utf8"));
        const engines = new Set(
            Object.entries(fm?.availability ?? {})
                .filter(([, on]) => on)
                .map(([engine]) => engine),
        );
        const list = byOpcode.get(n) ?? [];
        list.push({ file, engines });
        byOpcode.set(n, list);
    }
    const out = new Map<number, readonly OpcodePage[]>();
    for (const [n, pages] of byOpcode) {
        // Filename as the tiebreak so two pages of equal rank always order the same way across runs.
        out.set(
            n,
            [...pages].sort((a, b) => pageRank(a) - pageRank(b) || a.file.localeCompare(b.file)),
        );
    }
    return out;
}

/**
 * Opcode -> the name of its preferred reading. This is the flat table the effect spec uses as its `enum`, so
 * a record parsed with no game to ask still shows a name; a session that knows its engine re-picks from
 * `OpcodeReadings` instead.
 */
export function extractOpcodes(opcodesDir: string): ReadonlyMap<number, string> {
    const out = new Map<number, string>();
    for (const [n, readings] of extractOpcodeReadings(opcodesDir)) {
        const name = readings[0]?.name;
        if (name !== undefined && name !== "") out.set(n, name);
    }
    return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * Parses the fuller frontmatter needed for opcode relationship data: `n`, `param1`,
 * `param2`, and the per-engine availability flags. Returns `undefined` when `n` is
 * absent so the caller can skip the file.
 */
function parseRelationshipFrontmatter(text: string):
    | {
          n: number;
          opname?: string;
          labels: Partial<Record<OpcodeSlotKey, string>>;
          availability?: Readonly<Record<string, boolean>>;
      }
    | undefined {
    if (!text.startsWith("---")) return undefined;
    const end = text.indexOf("\n---", 3);
    if (end === -1) return undefined;
    const block = text.slice(4, end);

    let n: number | undefined;
    let opname: string | undefined;
    const labels: Partial<Record<OpcodeSlotKey, string>> = {};
    const availabilityEntries: [string, boolean][] = [];

    for (const line of block.split("\n")) {
        const colonAt = line.indexOf(":");
        if (colonAt === -1) continue;
        const key = line.slice(0, colonAt).trim();
        const rest = line.slice(colonAt + 1).trim();
        if (key === "n") {
            const parsed = Number.parseInt(rest, 10);
            if (Number.isFinite(parsed)) n = parsed;
        } else if (key === "opname") {
            opname = rest.replace(/^['"]/, "").replace(/['"]$/, "");
        } else if ((OPCODE_SLOT_KEYS as readonly string[]).includes(key)) {
            // IESDP writes frontmatter labels as HTML, so `&amp;` reaches the editor literally otherwise.
            labels[key as OpcodeSlotKey] = rest.replace(/^['"]/, "").replace(/['"]$/, "").replaceAll("&amp;", "&");
        } else if ((ENGINE_KEYS as readonly string[]).includes(key)) {
            // Values may have trailing whitespace (e.g. `bgee: 0 `).
            availabilityEntries.push([key, Number.parseInt(rest, 10) === 1]);
        }
    }

    if (n === undefined) return undefined;

    const availability = availabilityEntries.length > 0 ? Object.fromEntries(availabilityEntries) : undefined;
    return { n, opname, labels, availability };
}

/**
 * Every reading of every opcode, each opcode's readings ordered by `ENGINE_PREFERENCE` so index 0 is the one
 * an editor with no game to ask should use.
 *
 * A reading is a set of pages sharing an `opname`: the same effect described once per engine, or per engine
 * group. They are grouped rather than deduplicated because the engines that share a name still differ in what
 * their pages document - the EE-era `param3`-`param5` and `special` keys appear on only some of them - so the
 * slots are merged across a reading's own pages and never across two readings.
 */
export function extractOpcodeReadings(opcodesDir: string): ReadonlyMap<number, readonly OpcodeRelationship[]> {
    const out = new Map<number, readonly OpcodeRelationship[]>();
    if (!fs.existsSync(opcodesDir)) {
        throw new Error(`Opcodes directory not found: ${opcodesDir}`);
    }
    for (const [n, pages] of pagesForOpcode(opcodesDir)) {
        const parsed = pages
            .map((p) => parseRelationshipFrontmatter(fs.readFileSync(p.file, "utf8")))
            .filter((fm) => fm !== undefined);
        if (parsed.length === 0) continue;

        // Insertion order is the page order, which `pagesForOpcode` already sorted by engine preference - so
        // the readings come out preference-ordered too, and index 0 is the BG(2)EE one wherever it exists.
        const byName = new Map<string, typeof parsed>();
        for (const fm of parsed) {
            const name = fm.opname ?? "";
            byName.set(name, [...(byName.get(name) ?? []), fm]);
        }

        const readings: OpcodeRelationship[] = [];
        for (const [name, group] of byName) {
            const rel: OpcodeRelationship = { name };
            for (const key of OPCODE_SLOT_KEYS) {
                const label = group.map((fm) => fm.labels[key]).find((l) => l !== undefined);
                if (label !== undefined) rel[key] = { label };
            }
            // Which engines read the opcode THIS way - the union over the reading's own pages. Distinct from
            // `availability` below, which answers the broader "which engines have this opcode at all".
            const engines = ENGINE_KEYS.filter((e) => group.some((fm) => fm.availability?.[e] === true));
            if (engines.length > 0) rel.engines = engines;
            readings.push(rel);
        }

        // Availability spans every reading: it is displayed beside the opcode field to say where the number
        // exists, which is a different question from which engines read it the way the chosen reading does.
        const availability = parsed.reduce<Record<string, boolean>>((acc, fm) => {
            for (const [engine, on] of Object.entries(fm.availability ?? {})) {
                acc[engine] = (acc[engine] ?? false) || on;
            }
            return acc;
        }, {});
        if (Object.keys(availability).length > 0) {
            for (const rel of readings) rel.availability = availability;
        }
        out.set(n, readings);
    }
    return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * Picks the reading a curated entry was transcribed for, by its `reading` name.
 *
 * Where an opcode has one reading the name may be omitted. Where it has several, omitting it is an ERROR
 * rather than a default: a hand-read parameter table or resref type belongs to the engine whose page it was
 * read from, and quietly attaching it to whichever reading sorted first is how the wrong namespace gets
 * published (opcode 41's sparkle BAM is PSTEE's alone; the BG(2)EE reading of that number uses no resource).
 */
function readingFor(
    readings: readonly OpcodeRelationship[],
    opcode: number,
    reading: string | undefined,
    what: string,
): OpcodeRelationship {
    if (reading === undefined) {
        if (readings.length > 1) {
            const names = readings.map((r) => JSON.stringify(r.name)).join(", ");
            throw new Error(
                `Opcode ${opcode} has ${readings.length} readings (${names}); the ${what} override must name ` +
                    `the one it was transcribed from.`,
            );
        }
        return readings[0]!;
    }
    const match = readings.find((r) => r.name === reading);
    if (match === undefined) {
        const names = readings.map((r) => JSON.stringify(r.name)).join(", ");
        throw new Error(
            `Opcode ${opcode}'s ${what} override names reading ${JSON.stringify(reading)}, which IESDP no ` +
                `longer documents; it has ${names}.`,
        );
    }
    return match;
}

/**
 * Merges the harvested readings with the curated overrides. Within the reading each override names, it wins
 * per field: an override `enum` replaces any harvested one, an override `label` replaces the harvested label,
 * and a field the override omits keeps its harvested value.
 */
export function buildMergedReadings(opcodesDir: string): ReadonlyMap<number, readonly OpcodeRelationship[]> {
    const out = new Map<number, readonly OpcodeRelationship[]>();
    for (const [n, readings] of extractOpcodeReadings(opcodesDir)) {
        out.set(
            n,
            readings.map((r) => ({ ...r })),
        );
    }

    for (const [n, override] of Object.entries(OpcodeRelationshipOverrides)) {
        const num = Number(n);
        const readings = out.get(num);
        if (readings === undefined) continue;
        const target = readingFor(readings, num, override.reading, "parameter");

        for (const key of OPCODE_SLOT_KEYS) {
            const slot = override[key];
            if (slot === undefined) continue;
            target[key] = {
                label: slot.label ?? target[key]?.label,
                ...(slot.enum !== undefined ? { enum: slot.enum } : {}),
            };
        }
        if (override.idsFileByParam2 !== undefined) target.idsFileByParam2 = override.idsFileByParam2;
    }

    // Resref target types come from their own curated file, which states the reading alongside the type.
    for (const [n, decl] of Object.entries(OpcodeResourceOverrides)) {
        const num = Number(n);
        const readings = out.get(num);
        if (readings === undefined) continue;
        readingFor(readings, num, decl.reading, "resource").resourceType = decl.type;
    }

    return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** Serializes a numeric-keyed string enum to an inline object literal fragment, or returns undefined. */
function emitEnumLiteral(e: Readonly<Record<number, string>> | undefined): string | undefined {
    if (e === undefined) return undefined;
    const entries = Object.entries(e)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(", ");
    return `enum: { ${entries} }`;
}

/** Emit the generated `opcode-relationships.ts` source for the IE-common module. */
export function emitOpcodeRelationshipsModule(
    readings: ReadonlyMap<number, readonly OpcodeRelationship[]>,
    sourceRel: string,
): string {
    const lines: string[] = [
        `// Auto-generated from IESDP ${sourceRel}. Do not hand-edit.`,
        "",
        "/** One opcode-dependent field's display data: what to call it, and the values it is known to take. */",
        "export interface OpcodeSlot {",
        "    label?: string;",
        "    enum?: Readonly<Record<number, string>>;",
        "}",
        "",
        "/**",
        " * One engine's reading of an opcode number. There is no engine-neutral definition: 238 is",
        ' * "Stat: Save vs. all" on Icewind Dale and "Death: Disintegrate" on BG2/EE. Resolve with',
        " * `opcodeReading(opcode, engine)` rather than indexing, so the fallback stays in one place.",
        " */",
        "export interface OpcodeRelationship {",
        "    /** What this engine calls the opcode. */",
        "    name?: string;",
        "    /** The engines that read the opcode this way. */",
        "    engines?: readonly string[];",
        "    param1?: OpcodeSlot;",
        "    param2?: OpcodeSlot;",
        "    /** EE-era extra parameters; present only for the minority of opcodes that read them. */",
        "    param3?: OpcodeSlot;",
        "    param4?: OpcodeSlot;",
        "    param5?: OpcodeSlot;",
        "    /** The dword the spec calls a TobEx stacking id, which these opcodes read as their own field. */",
        "    special?: OpcodeSlot;",
        "    savingthrow?: OpcodeSlot;",
        "    power?: OpcodeSlot;",
        "    /** Which engines have the opcode AT ALL - spans every reading, unlike `engines` above. */",
        "    availability?: Readonly<Record<string, boolean>>;",
        "    /**",
        "     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's",
        "     * stored value -> the candidate tables it names, most preferred first (every present one contributes",
        "     * and the earlier wins a shared key, since editions disagree - ALIGN vs ALIGNMEN). The mapping is per",
        "     * opcode, not shared: 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2 is OBJECT not EA.",
        "     */",
        "    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;",
        "    /**",
        "     * What the effect's `resource` resref points at, as a resource-type extension. Per reading, since",
        "     * two engines sharing a number can point it at different namespaces; absent where the reading's",
        "     * pages name no target, or name two at once.",
        "     */",
        "    resourceType?: string;",
        "}",
        "",
        "/** Readings per opcode, most-preferred engine first. See `opcodeReading` for the selection rule. */",
        "export const OpcodeReadings: Readonly<Record<number, readonly OpcodeRelationship[]>> = {",
    ];
    for (const [n, rels] of readings) {
        lines.push(`    ${n}: [`);
        for (const rel of rels) lines.push(`        { ${emitReading(rel)} },`);
        lines.push("    ],");
    }
    lines.push("};", "");
    return lines.join("\n");
}

/** Serializes one reading's populated fields to an inline object-literal body. */
function emitReading(rel: OpcodeRelationship): string {
    const parts: string[] = [];
    if (rel.name !== undefined) parts.push(`name: ${JSON.stringify(rel.name)}`);
    if (rel.engines !== undefined) {
        parts.push(`engines: [${rel.engines.map((e) => JSON.stringify(e)).join(", ")}]`);
    }
    for (const key of OPCODE_SLOT_KEYS) {
        const slot = rel[key];
        if (slot === undefined) continue;
        const label = slot.label !== undefined ? `label: ${JSON.stringify(slot.label)}` : undefined;
        const enumPart = emitEnumLiteral(slot.enum);
        parts.push(`${key}: { ${[label, enumPart].filter(Boolean).join(", ")} }`);
    }
    if (rel.availability !== undefined) {
        const entries = Object.entries(rel.availability)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
        parts.push(`availability: { ${entries} }`);
    }
    if (rel.idsFileByParam2 !== undefined) {
        const entries = Object.entries(rel.idsFileByParam2)
            .map(([k, tables]) => `${k}: [${tables.map((t) => JSON.stringify(t)).join(", ")}]`)
            .join(", ");
        parts.push(`idsFileByParam2: { ${entries} }`);
    }
    if (rel.resourceType !== undefined) {
        parts.push(`resourceType: ${JSON.stringify(rel.resourceType)}`);
    }
    return parts.join(", ");
}

/** Emit the generated `opcodes.ts` source for the IE-common module. */
export function emitOpcodesModule(opcodes: ReadonlyMap<number, string>, sourceRel: string): string {
    const lines: string[] = [
        `// Auto-generated from IESDP ${sourceRel}. Do not hand-edit.`,
        "",
        "/**",
        " * Effect / EFF body opcode -> display name. Sourced from IESDP `_opcodes/op<NNN>.html` frontmatter",
        " * `opname` fields, falling back to the engine-variant pages for the opcodes that have no canonical",
        " * page - the EE and IWD2 ranges among them.",
        " */",
        "export const Opcodes: Readonly<Record<number, string>> = {",
    ];
    for (const [n, name] of opcodes) {
        // Escape the few characters that could break a JS string literal.
        const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        lines.push(`    ${n}: "${escaped}",`);
    }
    lines.push("};", "");
    return lines.join("\n");
}
