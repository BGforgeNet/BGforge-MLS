/**
 * FieldsBlock's multi-column grid template, as first rendered - at the schema's column count, before the pane fit
 * lowers it. A label reserve floors only the column holding a reserved field; every other column hugs its labels.
 */
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { Component } from "svelte";
import type { Row } from "@bgforge/binary-editor";
import FieldsBlock from "../../../src/binary-editor/webview/components/blocks/FieldsBlock.svelte";
import AffordanceHost from "./AffordanceHost.svelte";

const noop = (): void => undefined;

function row(i: number): Row {
    return {
        id: `0/${i}`,
        namePath: [`f${i}`],
        depth: 0,
        kind: "field",
        name: `F${i}`,
        valueType: "uint8",
        rawValue: 0,
        editable: true,
    };
}
const refs = Array.from({ length: 6 }, (_unused, i) => `f${i}`);
const fields = Object.fromEntries(refs.map((ref, i) => [ref, row(i)]));

function gridTemplate(props: Record<string, unknown>): string {
    const inner = FieldsBlock as Component<Record<string, unknown>>;
    const body = render(AffordanceHost, { props: { component: inner, props } }).body;
    return /grid-template-columns:([^;"]*)/.exec(body)?.[1] ?? "";
}

describe("FieldsBlock multi-column template", () => {
    it("fills column-major and floors only the column holding a reserved field", () => {
        // 6 fields over 3 columns: two per column, so f2 and f3 are column 2.
        const template = gridTemplate({
            fieldRefs: refs,
            fields,
            columns: 3,
            onedit: noop,
            byNode: new Map(),
            labelReserve: { fields: [{ ref: "f3", ch: 18 }] },
        });
        expect(template).toBe("max-content auto minmax(18ch,max-content) auto max-content auto");
    });

    it("hugs every column's labels when nothing is reserved", () => {
        const template = gridTemplate({ fieldRefs: refs, fields, columns: 2, onedit: noop, byNode: new Map() });
        expect(template).toBe("max-content auto max-content auto");
    });
});
