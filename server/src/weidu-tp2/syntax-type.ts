// Re-export of the generated SyntaxType enum. Its canonical home is
// shared/syntax-types/weidu-tp2.ts so @bgforge/format can consume it without
// importing server internals (which would form a format <-> server source
// cycle). Server code keeps importing "./syntax-type" unchanged; the generated
// tree-sitter.d.ts resolves its `import type { SyntaxType }` through here too.
export { SyntaxType } from "../../../shared/syntax-types/weidu-tp2";
