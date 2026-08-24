/**
 * Per-format size budgets shared by the parse path and the JSON-snapshot
 * load path.
 *
 * Parse path (`cli.ts`): applied via stat() before allocating a Buffer for a
 * raw binary file. Caps a malicious or accidentally-truncated file from
 * triggering a multi-GB allocation prior to header validation. Real-world
 * files stay well below these (largest published Fallout MAPs are ~250 KB;
 * ITM/SPL/EFF are in the low KB range; CRE embeds inventory/spell/effect
 * lists so it runs larger but stays in the low tens of KB; PRO has a 1 KB
 * hard limit enforced inside its parser; the largest DLG across a vanilla
 * BG:EE and BG2:ToB install - 4286 files - is 74 KB, and a heavily modded
 * one accumulates every mod's added states into a single file). Every
 * registry extension must have an entry here, enforced by
 * `test/max-file-sizes.test.ts`: the CLI skips the check outright when an
 * entry is missing rather than falling back to a default.
 *
 * Snapshot-load path (`json-snapshot.ts`'s per-format writers): the same
 * budget also bounds the buffer a canonical writer allocates when
 * serializing a JSON snapshot back to bytes. A JSON snapshot's declared
 * array lengths (abilities, effects, items, ...) drive that allocation
 * directly, and unlike the raw-file path nothing else caps it - a snapshot
 * declaring far more elements than any real file of that format could hold
 * would otherwise allocate well past the format's legitimate size envelope.
 * Reusing the parse-path budget here means both paths agree on what a
 * "real" file of the format can be.
 *
 * Override by editing this map, not by passing a flag - there is no
 * legitimate use case for parsing files or expanding snapshots past the cap.
 */
export const MAX_FILE_SIZES: Record<string, number> = {
    map: 16 * 1024 * 1024, // 16 MB
    pro: 1024,
    itm: 256 * 1024,
    spl: 256 * 1024,
    eff: 64 * 1024,
    cre: 256 * 1024,
    dlg: 1024 * 1024,
};
