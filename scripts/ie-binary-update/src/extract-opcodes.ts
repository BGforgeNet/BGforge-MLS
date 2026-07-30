/**
 * Extracts opcode-number -> name mapping from IESDP `_opcodes/op<NNN>.html`
 * frontmatter and emits a generated TS lookup table.
 *
 * IESDP files come in two flavours: `opNNN.html` (canonical, primary
 * opname) and `opNNN-<engine>.html` (engine-specific variant - same
 * number, alternative opname). The canonical page wins wherever one exists;
 * the variants describe alternate behaviours rather than alternate names.
 * An opcode with NO canonical page falls back to its variants - see
 * `pagesForOpcode` for why that fallback is load-bearing rather than an edge case.
 */

import fs from "node:fs";
import path from "node:path";
import { OpcodeRelationshipOverrides } from "./opcode-relationships.overrides.ts";
import { OpcodeResourceOverrides } from "./opcode-resources.overrides.ts";

interface OpcodeFrontmatter {
    readonly n: number;
    readonly opname: string;
}

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
 * Which engine's page speaks for an opcode that has no canonical one. The EE pages are both the most complete
 * (they carry the extra parameter/special keys at all) and the edition most of these opcodes belong to.
 * Matched by prefix, so `bg1-derived` ranks with `bg1`; an unlisted suffix sorts last, alphabetically.
 */
const VARIANT_PREFERENCE = ["bgee", "pstee", "ee", "bg2", "bg1", "iwd2", "iwd1", "pst"] as const;

/** The pages documenting one opcode: its canonical page if it has one, plus its variants in preference order. */
interface OpcodePages {
    canonical?: string;
    variants: readonly string[];
}

function variantRank(suffix: string): number {
    const i = VARIANT_PREFERENCE.findIndex((p) => suffix.startsWith(p));
    return i === -1 ? VARIANT_PREFERENCE.length : i;
}

/**
 * Every page documenting one opcode, most authoritative first: the canonical `opNNN.html` alone when it
 * exists, otherwise the engine variants in `VARIANT_PREFERENCE` order.
 *
 * The fallback is not a corner case. 137 of the 442 documented opcodes have no canonical page at all - every
 * EE opcode (318-383), every IWD2 opcode (400-457), and 13 others including 177 "Use EFF File", the single
 * most common effect opcode in a real install. Reading canonical files only dropped all of them from both
 * generated tables, so those opcodes rendered as a bare number with no name and no parameter labels.
 */
function pagesForOpcode(opcodesDir: string): ReadonlyMap<number, OpcodePages> {
    const canonical = new Map<number, string>();
    const variants = new Map<number, { suffix: string; file: string }[]>();
    for (const entry of fs.readdirSync(opcodesDir)) {
        const m = /^op(\d+)(?:-([a-z0-9-]+))?\.html$/.exec(entry);
        if (!m) continue;
        const n = Number.parseInt(m[1]!, 10);
        if (m[2] === undefined) {
            canonical.set(n, entry);
            continue;
        }
        const list = variants.get(n) ?? [];
        list.push({ suffix: m[2], file: entry });
        variants.set(n, list);
    }
    const out = new Map<number, OpcodePages>();
    for (const n of new Set([...canonical.keys(), ...variants.keys()])) {
        const c = canonical.get(n);
        const ordered = (variants.get(n) ?? [])
            .sort((a, b) => variantRank(a.suffix) - variantRank(b.suffix) || a.suffix.localeCompare(b.suffix))
            .map((v) => path.join(opcodesDir, v.file));
        out.set(n, {
            canonical: c === undefined ? undefined : path.join(opcodesDir, c),
            variants: ordered,
        });
    }
    return out;
}

function parseFrontmatter(text: string): OpcodeFrontmatter | undefined {
    if (!text.startsWith("---")) return undefined;
    const end = text.indexOf("\n---", 3);
    if (end === -1) return undefined;
    const block = text.slice(4, end);

    let n: number | undefined;
    let opname: string | undefined;
    for (const line of block.split("\n")) {
        const colonAt = line.indexOf(":");
        if (colonAt === -1) continue;
        const key = line.slice(0, colonAt).trim();
        const rest = line.slice(colonAt + 1).trim();
        if (key === "n") {
            const parsed = Number.parseInt(rest, 10);
            if (Number.isFinite(parsed)) n = parsed;
        } else if (key === "opname") {
            // opname may be quoted ("..." or '...') or bare. Strip surrounding
            // quotes; we do NOT interpret YAML escapes (none in real IESDP).
            const trimmed = rest.replace(/^['"]/, "").replace(/['"]$/, "");
            opname = trimmed;
        }
    }
    if (n === undefined || opname === undefined) return undefined;
    return { n, opname };
}

/** Returns a sorted-by-number map of opcode -> name. */
export function extractOpcodes(opcodesDir: string): ReadonlyMap<number, string> {
    const out = new Map<number, string>();
    if (!fs.existsSync(opcodesDir)) {
        throw new Error(`Opcodes directory not found: ${opcodesDir}`);
    }
    for (const [n, pages] of pagesForOpcode(opcodesDir)) {
        for (const page of [pages.canonical, ...pages.variants].filter((p) => p !== undefined)) {
            const fm = parseFrontmatter(fs.readFileSync(page, "utf8"));
            if (!fm) continue;
            out.set(n, fm.opname);
            break;
        }
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

/** Returns a sorted-by-number map of opcode number -> relationship data. */
export function extractOpcodeRelationships(opcodesDir: string): ReadonlyMap<number, OpcodeRelationship> {
    const out = new Map<number, OpcodeRelationship>();
    if (!fs.existsSync(opcodesDir)) {
        throw new Error(`Opcodes directory not found: ${opcodesDir}`);
    }
    for (const [n, pages] of pagesForOpcode(opcodesDir)) {
        const read = (p: string) => parseRelationshipFrontmatter(fs.readFileSync(p, "utf8"));
        const canonical = pages.canonical === undefined ? undefined : read(pages.canonical);
        const variants = pages.variants.map(read).filter((fm) => fm !== undefined);
        // A variant is only allowed to fill gaps in a canonical page when both describe the SAME opcode. Some
        // numbers were reused between editions - canonical 283 is Float Text where its EE page is Use EFF File
        // (Cursed) - and there the two pages' fields have nothing to do with each other.
        const sameOpcode = canonical === undefined ? variants : variants.filter((v) => v.opname === canonical.opname);
        const ordered = [canonical, ...sameOpcode].filter((fm) => fm !== undefined);
        if (ordered.length === 0) continue;

        const rel: OpcodeRelationship = {};
        // Per SLOT, not per page: the canonical page always wins a slot it defines, but the EE-era slots
        // (param3-5, special) are documented only on the engine variants, so a canonical opcode would otherwise
        // lose them entirely. Filling a gap can only add a label, never contradict one.
        for (const key of OPCODE_SLOT_KEYS) {
            const label = ordered.map((fm) => fm.labels[key]).find((l) => l !== undefined);
            if (label !== undefined) rel[key] = { label };
        }
        // Availability comes from the canonical page alone where there is one - it already carries the full
        // engine matrix. A variant declares only its own engine, so a variant-only opcode needs the union.
        const availability =
            canonical?.availability ??
            variants.reduce<Record<string, boolean>>((acc, fm) => {
                for (const [engine, on] of Object.entries(fm.availability ?? {})) {
                    acc[engine] = (acc[engine] ?? false) || on;
                }
                return acc;
            }, {});
        if (Object.keys(availability).length > 0) rel.availability = availability;
        out.set(n, rel);
    }
    return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * Merges harvested opcode relationship data with curated overrides. For each opcode
 * the override wins on a per-field basis: if the override supplies an `enum`, it
 * replaces any harvested enum; if the override supplies a `label`, it replaces the
 * harvested label. Fields absent from the override fall back to the harvested value.
 */
export function buildMergedRelationships(opcodesDir: string): ReadonlyMap<number, OpcodeRelationship> {
    const harvested = extractOpcodeRelationships(opcodesDir);
    const out = new Map<number, OpcodeRelationship>(harvested);

    // Two curated sources, one shape: parameter tables and IDS-file maps in one file, resref target types in
    // the other. Applied in sequence so each keeps its own file rather than one growing to hold both.
    const sources: readonly Readonly<Record<number, OpcodeRelationship>>[] = [
        OpcodeRelationshipOverrides,
        OpcodeResourceOverrides,
    ];
    for (const source of sources) {
        for (const [n, override] of Object.entries(source)) {
            const num = Number(n);
            const base = out.get(num) ?? {};
            const merged: OpcodeRelationship = { ...base };

            for (const key of OPCODE_SLOT_KEYS) {
                const slot = override[key];
                if (slot === undefined) continue;
                merged[key] = {
                    label: slot.label ?? base[key]?.label,
                    ...(slot.enum !== undefined ? { enum: slot.enum } : {}),
                };
            }
            if (override.availability !== undefined) merged.availability = override.availability;
            if (override.idsFileByParam2 !== undefined) merged.idsFileByParam2 = override.idsFileByParam2;
            if (override.resourceType !== undefined) merged.resourceType = override.resourceType;

            out.set(num, merged);
        }
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
    rels: ReadonlyMap<number, OpcodeRelationship>,
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
        "export interface OpcodeRelationship {",
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
        "    availability?: Readonly<Record<string, boolean>>;",
        "    /**",
        "     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's",
        "     * stored value -> the candidate tables it names, most preferred first (every present one contributes",
        "     * and the earlier wins a shared key, since editions disagree - ALIGN vs ALIGNMEN). The mapping is per",
        "     * opcode, not shared: 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2 is OBJECT not EA.",
        "     */",
        "    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;",
        "    /**",
        "     * What the effect's `resource` resref points at, as a resource-type extension. Declared only where",
        "     * every IESDP page for the opcode agrees; where engines disagree about the target the field stays",
        "     * unresolved rather than resolving against the wrong type.",
        "     */",
        "    resourceType?: string;",
        "}",
        "",
        "export const OpcodeRelationships: Readonly<Record<number, OpcodeRelationship>> = {",
    ];
    for (const [n, rel] of rels) {
        const parts: string[] = [];
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
        lines.push(`    ${n}: { ${parts.join(", ")} },`);
    }
    lines.push("};", "");
    return lines.join("\n");
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
