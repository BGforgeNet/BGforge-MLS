// Postprocess for the grammar type-generation pipeline (see grammars/*/package.json
// `generate:types` and scripts/build-grammar.sh).
//
// dts-tree-sitter emits the grammar's SyntaxType as an enum inside the generated
// tree-sitter.d.ts. An enum living only in a .d.ts has no runtime representation:
// esbuild inlines its members, but Rolldown/Rolldown-based bundlers (tsdown) treat
// the .d.ts as types-only and erase it, so `node.type === SyntaxType.X` silently
// becomes `=== undefined`. To make the values exist at runtime under any bundler,
// this splits the enum into a sibling runtime syntax-type.ts and rewrites the
// .d.ts to import the enum as a type (its own NamedNode<T extends SyntaxType> etc.
// still resolve). Consumers import the value from ./syntax-type.
//
// Usage: node split-syntax-type.mjs <tree-sitter.d.ts> <syntax-type.ts>
import fs from "node:fs";

const [dtsPath, outPath] = process.argv.slice(2);
if (!dtsPath || !outPath) {
    console.error("usage: split-syntax-type.mjs <tree-sitter.d.ts> <syntax-type.ts>");
    process.exit(1);
}

let dts = fs.readFileSync(dtsPath, "utf8");
const start = dts.indexOf("export enum SyntaxType {");
if (start === -1) {
    console.error(`split-syntax-type: no 'export enum SyntaxType' found in ${dtsPath}`);
    process.exit(1);
}
const close = dts.indexOf("\n}", start); // enum members carry no nested braces
const block = dts.slice(start, close + 2); // through the closing brace

const header =
    "// Auto-generated from the grammar by split-syntax-type.mjs. Do not hand-edit.\n" +
    "// Runtime SyntaxType enum, split out of tree-sitter.d.ts so the values exist\n" +
    "// at runtime under any bundler.\n";
fs.writeFileSync(outPath, header + block + "\n");

dts =
    `import type { SyntaxType } from "./syntax-type";\n\n` +
    dts.slice(0, start) +
    "// SyntaxType is a runtime enum in ./syntax-type (imported as a type above)." +
    dts.slice(close + 2);
fs.writeFileSync(dtsPath, dts);
