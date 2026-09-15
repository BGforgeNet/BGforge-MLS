/**
 * A field presents the same whichever block renderer the layout placed it in (docs/binary-editor-ui.md,
 * "Field-presentation features cover every block renderer, through one shared layer"). Each renderer is drawn
 * through Svelte's server renderer holding one row that carries one affordance, and the markup is asserted.
 *
 * InlineList, FormSection and ListEntryDetail fetch their rows in an effect, which a server render never runs;
 * they draw each row through `Field`, covered here, and their `byNode` wiring is a required prop svelte-check
 * enforces.
 */
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { Component } from "svelte";
import type { Diagnostic, ResolvedLayout, Row } from "@bgforge/binary-editor";
import { Bridge } from "../../../src/binary-editor/webview/state/bridge";
import Field from "../../../src/binary-editor/webview/components/Field.svelte";
import JoinedField from "../../../src/binary-editor/webview/components/JoinedField.svelte";
import LayoutRenderer from "../../../src/binary-editor/webview/components/LayoutRenderer.svelte";
import FieldsBlock from "../../../src/binary-editor/webview/components/blocks/FieldsBlock.svelte";
import FlagColumns from "../../../src/binary-editor/webview/components/blocks/FlagColumns.svelte";
import GridBlock from "../../../src/binary-editor/webview/components/blocks/GridBlock.svelte";
import MatrixBlock from "../../../src/binary-editor/webview/components/blocks/MatrixBlock.svelte";
import AffordanceHost from "./AffordanceHost.svelte";

const noop = (): void => undefined;
const SUBJECT_ID = "0/1";
const REF = "subject";
const OTHER = "other";

function numberRow(id: string, name: string, extra: Partial<Row> = {}): Row {
    return {
        id,
        namePath: [name],
        depth: 0,
        kind: "field",
        name,
        valueType: "uint8",
        rawValue: 3,
        editable: true,
        ...extra,
    };
}
const other = numberRow("0/2", "Bonus");

/** Markup of `component` under the handlers the real panel provides. */
function markup<P extends Record<string, unknown>>(component: Component<P>, props: P): string {
    // The generic host cannot be instantiated at P from a call through `render`, which infers its props from the
    // widest instantiation; `props` is still checked against `component` by this function's own signature.
    const inner = component as Component<Record<string, unknown>>;
    return render(AffordanceHost, { props: { component: inner, props } }).body;
}
const byNodeOf = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> =>
    new Map(diagnostics.length > 0 ? [[SUBJECT_ID, diagnostics]] : []);

type Renderer = (row: Row, diagnostics: Diagnostic[]) => string;
/** Every renderer that draws a numeric field control. `compact` ones are fixed-size cells (see CellControl). */
const renderers: { name: string; compact: boolean; draw: Renderer }[] = [
    { name: "Field", compact: false, draw: (row, d) => markup(Field, { row, onedit: noop, diagnostics: d }) },
    {
        name: "FieldsBlock",
        compact: false,
        draw: (row, d) =>
            markup(FieldsBlock, { fieldRefs: [REF], fields: { [REF]: row }, onedit: noop, byNode: byNodeOf(d) }),
    },
    {
        name: "GridBlock",
        compact: false,
        draw: (row, d) =>
            markup(GridBlock, {
                columns: 2,
                items: [REF, OTHER],
                fields: { [REF]: row, [OTHER]: other },
                onedit: noop,
                byNode: byNodeOf(d),
            }),
    },
    {
        name: "JoinedField",
        compact: true,
        draw: (row, d) =>
            markup(JoinedField, {
                label: "Dice",
                fieldRefs: [REF, OTHER],
                separator: ["d"],
                fields: { [REF]: row, [OTHER]: other },
                onedit: noop,
                byNode: byNodeOf(d),
            }),
    },
    {
        name: "FieldsBlock join",
        compact: true,
        draw: (row, d) =>
            markup(FieldsBlock, {
                fieldRefs: [REF, OTHER],
                joins: [{ label: "Dice", fields: [REF, OTHER], separator: ["d"] }],
                fields: { [REF]: row, [OTHER]: other },
                onedit: noop,
                byNode: byNodeOf(d),
            }),
    },
    {
        name: "MatrixBlock",
        compact: true,
        draw: (row, d) =>
            markup(MatrixBlock, {
                valueColumns: [
                    { key: "base", label: "Base" },
                    { key: "bonus", label: "Bonus" },
                ],
                groups: [{ label: "Primary", rows: [{ label: "Strength", cells: { base: REF, bonus: OTHER } }] }],
                fields: { [REF]: row, [OTHER]: other },
                onedit: noop,
                byNode: byNodeOf(d),
            }),
    },
];

const warning: Diagnostic = {
    nodeId: SUBJECT_ID,
    severity: "warning",
    message: "Slot references item #9 but only 3 items exist.",
    quickFix: { label: "Clear slot (-1)", edits: [{ nodeId: SUBJECT_ID, value: -1 }] },
};
const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe.each(renderers)("$name draws every per-row affordance", ({ compact, draw }) => {
    it("sanity: the bare row carries none of them", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject"), []);
        for (const marker of [
            "doc-link",
            "jump-link",
            "thumb",
            "diag",
            "quick-fix",
            "Read-only:",
            "strref",
            "gradient",
        ]) {
            expect(html, marker).not.toContain(marker);
        }
    });

    it("documentation link", () => {
        const html = draw(
            numberRow(SUBJECT_ID, "Subject", { docUrl: "https://example.invalid/doc", description: "What it is" }),
            [],
        );
        expect(count(html, 'class="doc-link"')).toBe(1);
        expect(html).toContain('href="https://example.invalid/doc"');
    });

    it("open chip", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject", { openTarget: { resref: "SW1H01", ext: "ITM" } }), []);
        expect(count(html, 'title="Open SW1H01.itm"')).toBe(1);
    });

    it("picture, which replaces the open chip", () => {
        const target = { resref: "ISW1H01", ext: "BAM" };
        const html = draw(numberRow(SUBJECT_ID, "Subject", { openTarget: target, thumbnail: target }), []);
        expect(count(html, 'class="thumb linked"')).toBe(1);
        expect(html).not.toContain('class="jump-link"');
    });

    it("animation chip", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject", { animationTarget: { id: 0x6000 } }), []);
        expect(count(html, 'title="Browse animation 0x6000"')).toBe(1);
    });

    it("jump link, exactly one control for the one action", () => {
        const link = { targetNodeId: "5/3", sectionKey: "items", label: "Item 3" };
        const html = draw(numberRow(SUBJECT_ID, "Subject", { link }), []);
        expect(count(html, 'title="Go to Item 3"')).toBe(1);
    });

    it("diagnostic marker with its quick fix", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject"), [warning]);
        expect(count(html, 'class="diag warning"')).toBe(1);
        expect(html).toContain(`aria-label="${warning.message}"`);
        expect(count(html, "quick-fix")).toBe(1);
        // A fixed-size cell names the fix in its tooltip; every other renderer spells it out.
        expect(html).toContain(compact ? 'title="Clear slot (-1)"' : "Clear slot (-1)</button>");
    });

    it("read-only reason on a locked row", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject", { editingLocked: true, editable: false }), []);
        expect(count(html, "Read-only: this field is in a region")).toBe(1);
    });

    it("allowed-range tooltip", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject", { min: 0, max: 255 }), []);
        expect(html).toContain("Allowed range: 0 to 255");
    });

    it(`resolved strref line ${compact ? "in the tooltip (fixed-size cell)" : "inline"}`, () => {
        const html = draw(
            numberRow(SUBJECT_ID, "Subject", { ref: { kind: "strref" }, strrefText: "Hail, traveller" }),
            [],
        );
        // Inline, the line is the input's idle value; in a fixed-size cell the input keeps the number.
        expect(html.includes('class="strref-line"')).toBe(!compact);
        expect(html).toContain(compact ? 'title="Hail, traveller"' : 'value="Hail, traveller"');
    });

    it("gradient colour picker", () => {
        const html = draw(numberRow(SUBJECT_ID, "Subject", { gradientColors: ["#ff0000", "#00ff00"] }), []);
        expect(count(html, 'class="gradient-swatch"')).toBe(1);
    });
});

it("GridBlock: a slot label that is the jump link keeps its doc link and draws no second jump chip", () => {
    const row = numberRow(SUBJECT_ID, "Weapon 2", {
        link: { targetNodeId: "5/3", sectionKey: "items", label: "Item 3" },
        docUrl: "https://example.invalid/doc",
    });
    const html = markup(GridBlock, {
        columns: 2,
        items: [REF],
        fields: { [REF]: row },
        onedit: noop,
        byNode: new Map(),
    });
    expect(html).toMatch(/<button[^>]*class="nm-link"[^>]*>Weapon 2<\/button>/);
    expect(count(html, 'class="doc-link"')).toBe(1);
    expect(html).not.toContain('class="jump-link"');
});

describe("flag fields draw their row affordances beside whatever names them", () => {
    const flags = (extra: Partial<Row> = {}): Row => ({
        ...numberRow(SUBJECT_ID, "Save Type", extra),
        valueType: "flags",
        flagOptions: { "1": "Spells", "2": "Breath" },
    });
    const decorated = flags({ docUrl: "https://example.invalid/doc", description: "Saving throw type" });

    it("a boxed flag block, in its legend", () => {
        const html = markup(FlagColumns, {
            field: REF,
            fields: { [REF]: decorated },
            onedit: noop,
            byNode: byNodeOf([warning]),
            boxed: true,
        });
        const legend = /<legend[^>]*>[\s\S]*?<\/legend>/.exec(html)?.[0] ?? "";
        expect(legend).toContain('class="doc-link"');
        expect(legend).toContain('class="diag warning"');
        expect(legend).toContain('title="Clear slot (-1)"');
    });

    it("a boxed flag block explains a locked row", () => {
        const html = markup(FlagColumns, {
            field: REF,
            fields: { [REF]: flags({ editingLocked: true }) },
            onedit: noop,
            boxed: true,
        });
        expect(html).toContain("Read-only: this field is in a region");
    });

    function layoutMarkup(rows: ResolvedLayout["rows"]): string {
        const layout: ResolvedLayout = {
            variantId: "v",
            rows,
            fields: { [REF]: decorated, [OTHER]: other },
            sections: {},
        };
        return render(LayoutRenderer, {
            props: {
                layout,
                onedit: noop,
                byNode: byNodeOf([warning]),
                bridge: new Bridge(noop),
                version: 0,
                selection: undefined,
            },
        }).body;
    }

    it("a flag block alone in a titled panel renders bare, so its panel title carries them", () => {
        const html = layoutMarkup([{ panels: [{ title: "Flags", blocks: [{ kind: "flags", field: REF }] }] }]);
        const title = /<h3[^>]*>[\s\S]*?<\/h3>/.exec(html)?.[0] ?? "";
        expect(title).toContain('class="doc-link"');
        expect(title).toContain('class="diag warning"');
        expect(html).not.toMatch(/<legend/);
    });

    it("a group's bare flags member, in the group legend", () => {
        const html = layoutMarkup([
            {
                panels: [
                    { title: "Effect", blocks: [{ kind: "group", label: "Parent", fields: [OTHER], flagsField: REF }] },
                ],
            },
        ]);
        const legend = /<legend[^>]*>[\s\S]*?<\/legend>/.exec(html)?.[0] ?? "";
        expect(legend).toContain('class="doc-link"');
        expect(legend).toContain('class="diag warning"');
        expect(html).not.toMatch(/<h3[^>]*>Effect<a /);
    });
});
