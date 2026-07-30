/**
 * Extracts opcode-number -> name mapping from IESDP `_opcodes/op<NNN>.html`
 * frontmatter and emits a generated TS lookup table.
 *
 * IESDP files come in two flavours: `opNNN.html` (canonical, primary
 * opname) and `opNNN-<engine>.html` (engine-specific variant - same
 * number, alternative opname). We only consume the canonical files; the
 * variants describe alternate behaviours rather than alternate names.
 */

import fs from "node:fs";
import path from "node:path";
import { OpcodeRelationshipOverrides } from "./opcode-relationships.overrides.ts";

interface OpcodeFrontmatter {
    readonly n: number;
    readonly opname: string;
}

export interface OpcodeRelationship {
    param1?: { label?: string; enum?: Readonly<Record<number, string>> };
    param2?: { label?: string; enum?: Readonly<Record<number, string>> };
    availability?: Readonly<Record<string, boolean>>;
    /**
     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's stored
     * value -> the candidate tables that value names, most preferred first (the same first-present-wins
     * ordering `ExternalRef`'s `tables` uses, since editions disagree - ALIGN vs ALIGNMEN).
     *
     * Not harvested: IESDP writes this list three different ways across the five opcodes that have it, and the
     * mapping is not shared between them (opcode 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2
     * is OBJECT rather than EA). Curated in the overrides file, per opcode, against each op<NNN>.html.
     */
    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;
}

const ENGINE_KEYS = ["bg1", "bg2", "bgee", "iwd1", "iwd2", "pst", "pstee"] as const;

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
    for (const entry of fs.readdirSync(opcodesDir)) {
        // Only canonical files (opNNN.html), not engine variants (opNNN-bgee.html).
        if (!/^op\d+\.html$/.test(entry)) continue;
        const text = fs.readFileSync(path.join(opcodesDir, entry), "utf8");
        const fm = parseFrontmatter(text);
        if (!fm) continue;
        out.set(fm.n, fm.opname);
    }
    return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * Parses the fuller frontmatter needed for opcode relationship data: `n`, `param1`,
 * `param2`, and the per-engine availability flags. Returns `undefined` when `n` is
 * absent so the caller can skip the file.
 */
function parseRelationshipFrontmatter(
    text: string,
): { n: number; param1?: string; param2?: string; availability?: Readonly<Record<string, boolean>> } | undefined {
    if (!text.startsWith("---")) return undefined;
    const end = text.indexOf("\n---", 3);
    if (end === -1) return undefined;
    const block = text.slice(4, end);

    let n: number | undefined;
    let param1: string | undefined;
    let param2: string | undefined;
    const availabilityEntries: [string, boolean][] = [];

    for (const line of block.split("\n")) {
        const colonAt = line.indexOf(":");
        if (colonAt === -1) continue;
        const key = line.slice(0, colonAt).trim();
        const rest = line.slice(colonAt + 1).trim();
        if (key === "n") {
            const parsed = Number.parseInt(rest, 10);
            if (Number.isFinite(parsed)) n = parsed;
        } else if (key === "param1") {
            param1 = rest.replace(/^['"]/, "").replace(/['"]$/, "");
        } else if (key === "param2") {
            param2 = rest.replace(/^['"]/, "").replace(/['"]$/, "");
        } else if ((ENGINE_KEYS as readonly string[]).includes(key)) {
            // Values may have trailing whitespace (e.g. `bgee: 0 `).
            availabilityEntries.push([key, Number.parseInt(rest, 10) === 1]);
        }
    }

    if (n === undefined) return undefined;

    const availability = availabilityEntries.length > 0 ? Object.fromEntries(availabilityEntries) : undefined;
    return { n, param1, param2, availability };
}

/** Returns a sorted-by-number map of opcode number -> relationship data. */
export function extractOpcodeRelationships(opcodesDir: string): ReadonlyMap<number, OpcodeRelationship> {
    const out = new Map<number, OpcodeRelationship>();
    if (!fs.existsSync(opcodesDir)) {
        throw new Error(`Opcodes directory not found: ${opcodesDir}`);
    }
    for (const entry of fs.readdirSync(opcodesDir)) {
        // Only canonical files (opNNN.html), not engine variants (opNNN-bgee.html).
        if (!/^op\d+\.html$/.test(entry)) continue;
        const text = fs.readFileSync(path.join(opcodesDir, entry), "utf8");
        const fm = parseRelationshipFrontmatter(text);
        if (!fm) continue;
        const rel: OpcodeRelationship = {};
        if (fm.param1 !== undefined) rel.param1 = { label: fm.param1 };
        if (fm.param2 !== undefined) rel.param2 = { label: fm.param2 };
        if (fm.availability !== undefined) rel.availability = fm.availability;
        out.set(fm.n, rel);
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

    for (const [n, override] of Object.entries(OpcodeRelationshipOverrides)) {
        const num = Number(n);
        const base = out.get(num) ?? {};
        const merged: OpcodeRelationship = { ...base };

        if (override.param1 !== undefined) {
            merged.param1 = {
                label: override.param1.label ?? base.param1?.label,
                ...(override.param1.enum !== undefined ? { enum: override.param1.enum } : {}),
            };
        }
        if (override.param2 !== undefined) {
            merged.param2 = {
                label: override.param2.label ?? base.param2?.label,
                ...(override.param2.enum !== undefined ? { enum: override.param2.enum } : {}),
            };
        }
        if (override.availability !== undefined) {
            merged.availability = override.availability;
        }
        if (override.idsFileByParam2 !== undefined) {
            merged.idsFileByParam2 = override.idsFileByParam2;
        }

        out.set(num, merged);
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
        "export interface OpcodeRelationship {",
        "    param1?: { label?: string; enum?: Readonly<Record<number, string>> };",
        "    param2?: { label?: string; enum?: Readonly<Record<number, string>> };",
        "    availability?: Readonly<Record<string, boolean>>;",
        "    /**",
        "     * For the opcodes that read parameter1 as an entry in an IDS file parameter2 SELECTS: parameter2's",
        "     * stored value -> the candidate tables it names, most preferred first (every present one contributes",
        "     * and the earlier wins a shared key, since editions disagree - ALIGN vs ALIGNMEN). The mapping is per",
        "     * opcode, not shared: 72 is 0-based where 55/100/175 are 2-based, and 178's slot 2 is OBJECT not EA.",
        "     */",
        "    idsFileByParam2?: Readonly<Record<number, readonly string[]>>;",
        "}",
        "",
        "export const OpcodeRelationships: Readonly<Record<number, OpcodeRelationship>> = {",
    ];
    for (const [n, rel] of rels) {
        const parts: string[] = [];
        if (rel.param1 !== undefined) {
            const label = rel.param1.label !== undefined ? `label: ${JSON.stringify(rel.param1.label)}` : undefined;
            const enumPart = emitEnumLiteral(rel.param1.enum);
            parts.push(`param1: { ${[label, enumPart].filter(Boolean).join(", ")} }`);
        }
        if (rel.param2 !== undefined) {
            const label = rel.param2.label !== undefined ? `label: ${JSON.stringify(rel.param2.label)}` : undefined;
            const enumPart = emitEnumLiteral(rel.param2.enum);
            parts.push(`param2: { ${[label, enumPart].filter(Boolean).join(", ")} }`);
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
        " * Effect / EFF body opcode -> display name. Sourced from IESDP `_opcodes/op<NNN>.html`",
        " * frontmatter `opname` fields (canonical files only, not engine-variant overrides).",
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
