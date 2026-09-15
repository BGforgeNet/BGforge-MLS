# Binary-editor render layer - what not to break

Every rule below, with its reasoning and the defects that produced it:
[docs/binary-editor-ui.md](../../../../docs/binary-editor-ui.md) (Render layer). The schema side is
[binary/src/AGENTS.md](../../../../binary/src/AGENTS.md).

## The shared-layer rule

A per-field presentation property added to ONE field renderer reaches every other through one shared helper, or
is declared N/A there with the reason. The renderer list and the affordances it covers: the doc above,
"Field-presentation features cover every block renderer, through one shared layer".

## Intentional - do not "fix"

A dropdown that looks roomy beside a short value (sized off its longest option), a control narrower than its
column track (the track sizes to the widest control; left edges stay aligned), a grid shedding columns
rather than overflowing (the schema's column count is a MAXIMUM, not a promise), and a narrow editor wrapping or
stacking what sits side by side at full width (the page never scrolls sideways).
