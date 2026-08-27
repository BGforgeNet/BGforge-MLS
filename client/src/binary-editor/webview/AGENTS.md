# Binary-editor render layer - what not to break

Every rule below, with its reasoning and the defects that produced it:
[docs/binary-editor-ui.md](../../../../docs/binary-editor-ui.md) (Render layer). The schema side is
[binary/src/AGENTS.md](../../../../binary/src/AGENTS.md).

## The shared-layer rule

Fields render through MULTIPLE components - `Field.svelte`, `blocks/FieldsBlock.svelte`, `blocks/GridBlock.svelte`,
`blocks/MatrixBlock.svelte`, with `CellControl.svelte` dispatching controls underneath. A per-field presentation
property (tooltip, range hint, advisory, link affordance) added to ONE of them is a defect unless every other
renderer either gets it through one shared helper - never a per-block copy - or is explicitly declared N/A with
the reason. A field's presentation must not depend on which block kind the schema happened to place it in.

## Intentional - do not "fix"

A dropdown that looks roomy beside a short value (sized off its longest option), a control narrower than its
column track (the track sizes to the widest control; left edges stay aligned), and a grid shedding columns
rather than overflowing (the schema's column count is a MAXIMUM, not a promise).
