/**
 * Host-level enforcement of `editingLocked`.
 *
 * `BinaryDocument.applyEdit` routes its field lookup through
 * `findEditableField` from the binary package, so any caller — webview-bound
 * or programmatic — that targets a field inside an `editingLocked` group
 * receives `undefined` and the parsed tree is not mutated. The flag itself
 * lives on `ParsedGroup`; this test asserts the host honours it.
 */

import { vi, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners: Array<(e: T) => void> = [];
        event = (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
        };
        fire(data: T) {
            for (const l of this.listeners) l(data);
        }
        dispose() {
            this.listeners = [];
        }
    }
    return { EventEmitter, Uri: { file: (p: string) => ({ fsPath: p, scheme: "file", toString: () => p }) } };
});

import { mapParser, type ParsedField, type ParsedGroup } from "@bgforge/binary";
import { BinaryDocument } from "../src/editors/binaryEditor-document";

const fieldIdFromSegments = (...parts: string[]) => JSON.stringify(parts);

function isGroup(x: ParsedField | ParsedGroup): x is ParsedGroup {
    return "fields" in x;
}

function findFirstSceneryGroup(root: ParsedGroup): ParsedGroup | undefined {
    if (/^Object \d+\.\d+ \(Scenery\)$/.test(root.name)) return root;
    for (const child of root.fields) {
        if (isGroup(child)) {
            const found = findFirstSceneryGroup(child);
            if (found) return found;
        }
    }
    return undefined;
}

function pathToFirstNumericFieldUnder(root: ParsedGroup, target: ParsedGroup): readonly string[] | undefined {
    const stack: { node: ParsedGroup; path: string[] }[] = [{ node: root, path: [] }];
    while (stack.length > 0) {
        const { node, path: groupPath } = stack.pop()!;
        if (node === target) {
            for (const child of node.fields) {
                if (!isGroup(child) && (child.type === "uint32" || child.type === "int32")) {
                    return [...groupPath, target.name, child.name];
                }
                if (isGroup(child)) {
                    for (const grandchild of child.fields) {
                        if (!isGroup(grandchild) && (grandchild.type === "uint32" || grandchild.type === "int32")) {
                            return [...groupPath, target.name, child.name, grandchild.name];
                        }
                    }
                }
            }
            return undefined;
        }
        for (const child of node.fields) {
            if (isGroup(child)) stack.push({ node: child, path: [...groupPath, node.name] });
        }
    }
    return undefined;
}

function loadArcavesDocument(): BinaryDocument {
    const mapPath = path.resolve("client/testFixture/maps/arcaves.map");
    const parseResult = mapParser.parse(new Uint8Array(fs.readFileSync(mapPath)));
    return new BinaryDocument({ fsPath: mapPath, scheme: "file", toString: () => mapPath } as never, parseResult, {
        parse: mapParser.parse.bind(mapParser),
        serialize: mapParser.serialize!.bind(mapParser),
    });
}

describe("BinaryDocument refuses edits inside editingLocked groups", () => {
    it("applyEdit on a Scenery object's field returns undefined and leaves the field unchanged", () => {
        const doc = loadArcavesDocument();
        const scenery = findFirstSceneryGroup(doc.parseResult.root);
        expect(scenery, "expected at least one Scenery object in arcaves").toBeDefined();
        expect(scenery?.editingLocked).toBe(true);

        const segments = pathToFirstNumericFieldUnder(doc.parseResult.root, scenery!);
        expect(segments, "expected a numeric field under the Scenery group").toBeDefined();

        const fieldId = fieldIdFromSegments(...segments!);
        const fieldName = segments![segments!.length - 1]!;
        const targetField = scenery!.fields.find((f): f is ParsedField => !isGroup(f) && f.name === fieldName);
        const targetGroup =
            targetField === undefined
                ? scenery!.fields.find(
                      (f): f is ParsedGroup => isGroup(f) && f.fields.some((g) => !isGroup(g) && g.name === fieldName),
                  )
                : undefined;
        const before = (targetField ?? targetGroup!.fields.find((f) => !isGroup(f) && f.name === fieldName)) as
            | ParsedField
            | undefined;
        const beforeRaw = before?.rawValue;
        const beforeValue = before?.value;

        const edit = doc.applyEdit(fieldId, segments!.join("."), 0xdeadbeef, "0xdeadbeef");

        expect(edit, "applyEdit on a locked field must return undefined").toBeUndefined();
        expect(before?.rawValue, "rawValue must not have been mutated").toBe(beforeRaw);
        expect(before?.value, "value must not have been mutated").toBe(beforeValue);
    });
});
