/**
 * Unit tests for BinaryDocument edit model.
 * Tests field lookup, edit application, undo/redo callbacks, and serialization.
 */

import { vi, describe, expect, it, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock vscode EventEmitter with a minimal implementation
vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners: Array<(e: T) => void> = [];
        event = (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    this.listeners = this.listeners.filter((l) => l !== listener);
                },
            };
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

import { BinaryDocument } from "../src/editors/binaryEditor-document";
import { type ParseResult, mapParser, proParser } from "@bgforge/binary";
import { buildBinaryEditorTreeState } from "../src/editors/binaryEditor-tree";

function makeTestResult(): ParseResult {
    return {
        format: "pro",
        formatName: "Fallout PRO (Prototype)",
        document: {
            header: {
                objectType: 5,
                objectId: 1,
                textId: 100,
                frmType: 5,
                frmId: 9,
                lightRadius: 8,
                lightIntensity: 65_536,
                flags: 536_870_912,
            },
            sections: {
                miscProperties: {
                    unknown: 0,
                },
            },
        },
        root: {
            name: "PRO File",
            fields: [
                {
                    name: "Header",
                    expanded: true,
                    fields: [
                        { name: "Object Type", value: "Misc", offset: 0, size: 1, type: "enum", rawValue: 5 },
                        { name: "Object ID", value: 1, offset: 1, size: 3, type: "uint24" },
                        { name: "Text ID", value: 100, offset: 4, size: 4, type: "uint32" },
                        { name: "FRM Type", value: "Background", offset: 8, size: 1, type: "enum", rawValue: 5 },
                        { name: "FRM ID", value: 9, offset: 9, size: 3, type: "uint24" },
                        { name: "Light Radius", value: 8, offset: 12, size: 4, type: "uint32" },
                        { name: "Light Intensity", value: 65_536, offset: 16, size: 4, type: "uint32" },
                        {
                            name: "Flags",
                            value: "LightThru",
                            offset: 20,
                            size: 4,
                            type: "flags",
                            rawValue: 536_870_912,
                        },
                    ],
                },
                {
                    name: "Misc Properties",
                    expanded: true,
                    fields: [{ name: "Unknown", value: 0, offset: 24, size: 4, type: "uint32" }],
                },
            ],
        },
    };
}

// Provide vscode.Uri for the document constructor
const fakeUri = { fsPath: "/test/file.pro", scheme: "file", toString: () => "/test/file.pro" } as any;
const fieldId = (...parts: string[]) => JSON.stringify(parts);

function loadMapDocument(mapName: string): BinaryDocument {
    const mapPath = path.resolve("client/testFixture/maps", mapName);
    const parseResult = mapParser.parse(new Uint8Array(fs.readFileSync(mapPath)));
    return new BinaryDocument({ fsPath: mapPath, scheme: "file", toString: () => mapPath } as any, parseResult, {
        parse: mapParser.parse.bind(mapParser),
        serialize: mapParser.serialize!.bind(mapParser),
    });
}

function loadProDocument(proPath: string): BinaryDocument {
    const parseResult = proParser.parse(new Uint8Array(fs.readFileSync(proPath)));
    return new BinaryDocument({ fsPath: proPath, scheme: "file", toString: () => proPath } as any, parseResult, {
        parse: proParser.parse.bind(proParser),
        serialize: proParser.serialize!.bind(proParser),
    });
}

describe("BinaryDocument", () => {
    let doc: BinaryDocument;

    beforeEach(() => {
        doc = new BinaryDocument(fakeUri, makeTestResult(), () => new Uint8Array([1, 2, 3]));
    });

    it("exposes the parse result", () => {
        expect(doc.parseResult.format).toBe("pro");
        expect(doc.parseResult.root.name).toBe("PRO File");
    });

    describe("applyEdit", () => {
        it("edits a numeric field by path", () => {
            const edit = doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 200, "200");
            expect(edit).toBeDefined();
            expect(edit!.oldRawValue).toBe(100);
            expect(edit!.newRawValue).toBe(200);

            // Verify the field was updated
            const header = doc.parseResult.root.fields[0] as any;
            const textId = header.fields.find((f: any) => f.name === "Text ID");
            expect(textId.value).toBe("200");
            expect(textId.rawValue).toBe(200);
            expect((doc.parseResult.document as any).header.textId).toBe(200);
        });

        it("edits an enum field preserving rawValue", () => {
            const edit = doc.applyEdit(fieldId("Header", "FRM Type"), "Header.FRM Type", 0, "Items");
            expect(edit).toBeDefined();
            expect(edit!.oldRawValue).toBe(5);

            const header = doc.parseResult.root.fields[0] as any;
            const frmType = header.fields.find((f: any) => f.name === "FRM Type");
            expect(frmType.value).toBe("Items");
            expect(frmType.rawValue).toBe(0);
            expect((doc.parseResult.document as any).header.frmType).toBe(0);
        });

        it("keeps editing responsive when the tree becomes temporarily invalid for canonical sync", () => {
            const proDoc = loadProDocument(path.resolve("client/testFixture/proto/misc/00000001.pro"));

            expect(() =>
                proDoc.applyEdit(fieldId("Header", "Object Type"), "Header.Object Type", 1, "Critter"),
            ).not.toThrow();
            expect(proDoc.parseResult.document).toBeDefined();

            const groupNames = proDoc.parseResult.root.fields
                .filter(
                    (entry): entry is { name: string; fields: unknown[] } =>
                        typeof entry === "object" && entry !== null && "fields" in entry,
                )
                .map((entry) => entry.name);
            expect(groupNames).toContain("Critter Properties");
            expect(groupNames).not.toContain("Misc Properties");
        });

        it("returns undefined for nonexistent field", () => {
            const edit = doc.applyEdit(fieldId("Header", "Nonexistent"), "Header.Nonexistent", 42, "42");
            expect(edit).toBeUndefined();
        });

        it("fires onDidChange event with document, label, undo, and redo", () => {
            const events: any[] = [];
            doc.onDidChange((e) => events.push(e));

            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 200, "200");
            expect(events).toHaveLength(1);
            expect(events[0].document).toBe(doc);
            expect(events[0].label).toBe("Edit Header.Text ID");
            expect(typeof events[0].undo).toBe("function");
            expect(typeof events[0].redo).toBe("function");
        });

        it("fires onDidChangeContent event", () => {
            let fired = false;
            doc.onDidChangeContent(() => {
                fired = true;
            });

            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 200, "200");
            expect(fired).toBe(true);
        });
    });

    describe("undo/redo", () => {
        it("undo restores the previous value", () => {
            const events: any[] = [];
            doc.onDidChange((e) => events.push(e));

            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 200, "200");
            events[0].undo();

            const header = doc.parseResult.root.fields[0] as any;
            const textId = header.fields.find((f: any) => f.name === "Text ID");
            expect(textId.value).toBe("100");
        });

        it("redo reapplies the edit", () => {
            const events: any[] = [];
            doc.onDidChange((e) => events.push(e));

            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 200, "200");
            events[0].undo();
            events[0].redo();

            const header = doc.parseResult.root.fields[0] as any;
            const textId = header.fields.find((f: any) => f.name === "Text ID");
            expect(textId.value).toBe("200");
            expect(textId.rawValue).toBe(200);
        });
    });

    describe("reset", () => {
        it("replaces the parse result and fires content change", () => {
            let fired = false;
            doc.onDidChangeContent(() => {
                fired = true;
            });

            const newResult = makeTestResult();
            (newResult.root.fields[0] as any).fields[2].value = 999;
            doc.reset(newResult);

            expect(doc.parseResult).toBe(newResult);
            expect(fired).toBe(true);
        });
    });

    describe("replaceParseResult", () => {
        it("replaces the parse result through undoable document edit events", () => {
            const events: any[] = [];
            doc.onDidChange((event) => events.push(event));

            const replacement = makeTestResult();
            (replacement.root.fields[0] as any).fields[2].value = 777;

            doc.replaceParseResult(replacement, "Load JSON snapshot");

            expect(doc.parseResult).toStrictEqual(replacement);
            expect(doc.parseResult).not.toBe(replacement);
            expect(events).toHaveLength(1);
            expect(events[0].label).toBe("Load JSON snapshot");

            events[0].undo();
            expect(doc.parseResult.root.fields[0]).not.toBe(replacement.root.fields[0]);
            expect((doc.parseResult.root.fields[0] as any).fields[2].value).toBe(100);

            events[0].redo();
            expect(doc.parseResult).toStrictEqual(replacement);
            expect(doc.parseResult).not.toBe(replacement);
        });

        it("restores the originally loaded snapshot on redo after later edits", () => {
            const events: any[] = [];
            doc.onDidChange((event) => events.push(event));

            const replacement = makeTestResult();
            (replacement.root.fields[0] as any).fields[2].value = 777;
            doc.replaceParseResult(replacement, "Load JSON snapshot");
            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 888, "888");

            events[1].undo();
            events[0].undo();
            events[0].redo();

            const header = doc.parseResult.root.fields[0] as any;
            const textId = header.fields.find((f: any) => f.name === "Text ID");
            expect(textId.value).toBe(777);
            expect(textId.rawValue).toBeUndefined();
        });

        it("reapplies later field edits after a load undo/redo cycle", () => {
            const events: any[] = [];
            doc.onDidChange((event) => events.push(event));

            const replacement = makeTestResult();
            (replacement.root.fields[0] as any).fields[2].value = 777;
            doc.replaceParseResult(replacement, "Load JSON snapshot");
            doc.applyEdit(fieldId("Header", "Text ID"), "Header.Text ID", 888, "888");

            events[1].undo();
            events[0].undo();
            events[0].redo();
            events[1].redo();

            const header = doc.parseResult.root.fields[0] as any;
            const textId = header.fields.find((f: any) => f.name === "Text ID");
            expect(textId.value).toBe("888");
            expect(textId.rawValue).toBe(888);
        });
    });

    describe("getContent", () => {
        it("returns a Uint8Array", () => {
            const content = doc.getContent();
            expect(content).toBeInstanceOf(Uint8Array);
            expect(content.length).toBeGreaterThan(0);
        });
    });

    describe("dispose", () => {
        it("does not throw", () => {
            expect(() => doc.dispose()).not.toThrow();
        });
    });

    describe("MAP field identity", () => {
        it("resolves editable fields by opaque field id even when display names contain dots", () => {
            const mapDoc = loadMapDocument("arcaves.map");
            const tree = buildBinaryEditorTreeState(mapDoc.parseResult);
            const init = tree.getInitMessagePayload();

            const objectsNode = init.rootChildren.find((node) => node.name === "Objects Section");
            expect(objectsNode).toBeDefined();
            const elevation0 = tree.getChildren(objectsNode!.id).find((node) => node.name === "Elevation 0 Objects");
            expect(elevation0).toBeDefined();
            const object18 = tree.getChildren(elevation0!.id).find((node) => node.name === "Object 0.18 (Misc)");
            expect(object18).toBeDefined();
            const rotation = tree.getChildren(object18!.id).find((node) => node.name === "Rotation");

            expect(rotation).toBeDefined();
            expect(rotation?.fieldPath).toBe("Objects Section.Elevation 0 Objects.Object 0.18 (Misc).Rotation");
            expect(rotation?.fieldId).toBeDefined();
            expect(mapDoc.getFieldById(rotation!.fieldId!)).toMatchObject({
                name: "Rotation",
                type: "enum",
            });
        });
    });

    describe("string field edits", () => {
        it("applies a new filename and round-trips through the canonical document", () => {
            const mapDoc = loadMapDocument("arcaves.map");
            const filenameId = fieldId("Header", "Filename");

            const edit = mapDoc.applyEdit(filenameId, "Header.Filename", "NEWNAME.SAV", "NEWNAME.SAV");
            expect(edit).toBeDefined();
            expect(edit!.newRawValue).toBe("NEWNAME.SAV");

            // The parsed-tree field reflects the new value...
            const filenameField = mapDoc.getFieldById(filenameId);
            expect(filenameField?.value).toBe("NEWNAME.SAV");

            // ...and the canonical document picks it up via rebuildCanonicalDocument.
            expect((mapDoc.parseResult.document as { header: { filename: string } }).header.filename).toBe(
                "NEWNAME.SAV",
            );
        });
    });
});
