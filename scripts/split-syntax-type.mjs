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
import path from "node:path";

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
// A grammar that declares `supertypes:` gets their direct members as runtime sets, read from the node-types.json
// beside the .d.ts, so a consumer asks "is this an action?" of the grammar rather than of a node-type prefix.
const nodeTypes = JSON.parse(fs.readFileSync(path.join(path.dirname(dtsPath), "node-types.json"), "utf8"));
const supertypes = nodeTypes.filter((entry) => Array.isArray(entry.subtypes));
const subtypesBlock =
    supertypes.length === 0
        ? ""
        : "\n/** The direct members of each supertype the grammar declares; the keys are literal, so a consumer of a\n" +
          " * supertype the grammar drops fails to compile. */\n" +
          "export const SUBTYPES = {\n" +
          supertypes
              .map((entry) => {
                  const members = entry.subtypes.map((subtype) => `    ${JSON.stringify(subtype.type)},`).join("\n");
                  // A supertype is a hidden rule (`_action`); its key drops the underscore, which only marks it
                  // hidden in the grammar.
                  const key = entry.type.replace(/^_/, "");
                  return `  ${key}: new Set<string>([\n${members}\n  ]),\n`;
              })
              .join("") +
          "} as const;\n";
// The grammar's word token and reserved words, read from the grammar.json beside the .d.ts, for code that writes
// source where the grammar is not loaded (a webview) and must know which names can stand bare.
const grammarJson = JSON.parse(fs.readFileSync(path.join(path.dirname(dtsPath), "grammar.json"), "utf8"));
const wordRule = grammarJson.word ? grammarJson.rules[grammarJson.word] : undefined;
const wordBlock =
    wordRule?.type === "PATTERN"
        ? "\n/** The pattern of the grammar's word token (its bare names). */\n" +
          `export const WORD_PATTERN = ${JSON.stringify(wordRule.value)};\n`
        : "";
const reserved = (grammarJson.reserved?.global ?? [])
    .filter((rule) => rule.type === "STRING")
    .map((rule) => rule.value);
const reservedBlock =
    reserved.length === 0
        ? ""
        : "\n/** The words the grammar reserves: never a bare name. */\n" +
          "export const RESERVED_WORDS: ReadonlySet<string> = new Set<string>([\n" +
          reserved.map((word) => `  ${JSON.stringify(word)},`).join("\n") +
          "\n]);\n";
fs.writeFileSync(outPath, header + block + "\n" + subtypesBlock + wordBlock + reservedBlock);

dts =
    `import type { SyntaxType } from "./syntax-type";\n\n` +
    dts.slice(0, start) +
    "// SyntaxType is a runtime enum in ./syntax-type (imported as a type above)." +
    dts.slice(close + 2);
fs.writeFileSync(dtsPath, dts);
