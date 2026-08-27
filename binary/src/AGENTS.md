# Layout schema - what not to break

Applies when authoring the DECLARATIVE LAYOUT for a binary format: `*/layout-schema.ts`,
`ie-common/effect-layout.ts`, `feature-block-layout.ts`, the per-format ability fragments, the presentation
schema. **Skip this for parser / codec / spec-data work** - it is only about how a parsed record is presented.

Every rule below, with its reasoning and worked examples:
[docs/binary-editor-ui.md](../../docs/binary-editor-ui.md) (Schema layer). The render side is
[client/src/binary-editor/webview/AGENTS.md](../../client/src/binary-editor/webview/AGENTS.md).

## Do not

- **Vendor a name table for a value space the install owns.** Declare `tables`; vendor only keys no shipped
  table can reach, verbatim.
- **Resolve anything here.** Resolution needs an open game; the library stops at the declaration.
- **Prettify raw bytes or guess a game-specific slot name.** Mojibake in a raw-byte field and "Proficiency N"
  for a slot whose name differs across games are both faithful, not unfinished.

## Intentional - do not "fix"

Parallel-not-identical fragments (an ITM ability has panels a SPL ability lacks), a flag block boxed in one
place and bare in another (share-vs-sole), category-grouped flags crossing wire byte boundaries, hex on
type-encoded IDs but decimal on a plain index, and a PRO panel holding a single field.
