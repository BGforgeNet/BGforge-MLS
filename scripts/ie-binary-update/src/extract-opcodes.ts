/**
 * Extracts opcode-number → name mapping from IESDP `_opcodes/op<NNN>.html`
 * frontmatter and emits a generated TS lookup table.
 *
 * IESDP files come in two flavours: `opNNN.html` (canonical, primary
 * opname) and `opNNN-<engine>.html` (engine-specific variant — same
 * number, alternative opname). We only consume the canonical files; the
 * variants describe alternate behaviours rather than alternate names.
 */

import fs from "node:fs";
import path from "node:path";

interface OpcodeFrontmatter {
    readonly n: number;
    readonly opname: string;
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

/** Returns a sorted-by-number map of opcode → name. */
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

/** Emit the generated `opcodes.ts` source for the IE-common module. */
export function emitOpcodesModule(opcodes: ReadonlyMap<number, string>, sourceRel: string): string {
    const lines: string[] = [];
    lines.push(`// Auto-generated from IESDP ${sourceRel}. Do not hand-edit.`);
    lines.push("");
    lines.push("/**");
    lines.push(" * Effect / EFF body opcode → display name. Sourced from IESDP `_opcodes/op<NNN>.html`");
    lines.push(" * frontmatter `opname` fields (canonical files only, not engine-variant overrides).");
    lines.push(" */");
    lines.push("export const Opcodes: Readonly<Record<number, string>> = {");
    for (const [n, name] of opcodes) {
        // Escape the few characters that could break a JS string literal.
        const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        lines.push(`    ${n}: "${escaped}",`);
    }
    lines.push("};");
    lines.push("");
    return lines.join("\n");
}
