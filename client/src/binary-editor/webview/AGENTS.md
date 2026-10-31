# Binary-editor render layer - what not to break

Every rule below, with its reasoning and the defects that produced it:
[docs/binary-editor-ui.md](../../../../docs/binary-editor-ui.md) (Render layer). The schema side is
[binary/src/AGENTS.md](../../../../binary/src/AGENTS.md).

## The shared-layer rule

A per-field presentation property added to ONE field renderer reaches every other through one shared helper, or
is declared N/A there with the reason. The renderer list and the affordances it covers: the doc above,
"Field-presentation features cover every block renderer, through one shared layer".

## Intentional - do not "fix"

The list of patterns a review must not flag, each with its reason:
[docs/binary-editor-ui.md](../../../../docs/binary-editor-ui.md) (Reviewing a rendered screenshot).
