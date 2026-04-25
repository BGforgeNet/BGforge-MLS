import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ParseResult, createBinaryJsonSnapshot } from "@bgforge/binary";

const { writeFile, getConfiguration } = vi.hoisted(() => ({
    writeFile: vi.fn(),
    getConfiguration: vi.fn(),
}));

vi.mock("vscode", () => ({
    workspace: {
        fs: {
            writeFile,
        },
        getConfiguration,
    },
    Uri: {
        file: (fsPath: string) => ({
            fsPath,
            path: fsPath,
            scheme: "file",
            authority: "",
            toString: () => fsPath,
            with: ({ path }: { path: string }) => ({
                fsPath: path,
                path,
                scheme: "file",
                authority: "",
                toString: () => path,
            }),
        }),
    },
}));

import { saveBinaryDocumentArtifacts } from "../src/editors/binaryEditor-save";

function makeParseResult(): ParseResult {
    return {
        format: "pro",
        formatName: "Fallout PRO (Prototype)",
        root: {
            name: "PRO File",
            expanded: true,
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

function makeFileUri(fsPath: string): any {
    return {
        fsPath,
        path: fsPath,
        scheme: "file",
        authority: "",
        toString: () => fsPath,
        with: ({ path }: { path: string }) => makeFileUri(path),
    };
}

describe("saveBinaryDocumentArtifacts", () => {
    const documentUri = makeFileUri("/tmp/test.pro");
    const bytes = new Uint8Array([1, 2, 3]);

    beforeEach(() => {
        writeFile.mockReset();
        getConfiguration.mockReset();
    });

    it("writes only the binary file when auto dump is disabled", async () => {
        getConfiguration.mockReturnValue({
            get: vi.fn().mockReturnValue(false),
        });

        await saveBinaryDocumentArtifacts(documentUri, documentUri, bytes, makeParseResult());

        expect(writeFile).toHaveBeenCalledTimes(1);
        expect(writeFile).toHaveBeenNthCalledWith(1, documentUri, bytes);
    });

    it("writes a JSON snapshot alongside the saved binary when auto dump is enabled", async () => {
        getConfiguration.mockReturnValue({
            get: vi.fn().mockReturnValue(true),
        });

        await saveBinaryDocumentArtifacts(documentUri, documentUri, bytes, makeParseResult());

        expect(writeFile).toHaveBeenCalledTimes(2);
        expect(writeFile).toHaveBeenNthCalledWith(1, documentUri, bytes);
        expect(writeFile).toHaveBeenNthCalledWith(
            2,
            {
                fsPath: "/tmp/test.pro.json",
                path: "/tmp/test.pro.json",
                scheme: "file",
                authority: "",
                toString: expect.any(Function),
                with: expect.any(Function),
            },
            Buffer.from(createBinaryJsonSnapshot(makeParseResult()), "utf8"),
        );
    });

    it("uses the destination path for save-as JSON snapshots", async () => {
        const destinationUri = makeFileUri("/tmp/renamed.pro");
        getConfiguration.mockReturnValue({
            get: vi.fn().mockReturnValue(true),
        });

        await saveBinaryDocumentArtifacts(documentUri, destinationUri, bytes, makeParseResult());

        expect(writeFile).toHaveBeenCalledTimes(2);
        expect(writeFile).toHaveBeenNthCalledWith(1, destinationUri, bytes);
        expect(writeFile).toHaveBeenNthCalledWith(
            2,
            {
                fsPath: "/tmp/renamed.pro.json",
                path: "/tmp/renamed.pro.json",
                scheme: "file",
                authority: "",
                toString: expect.any(Function),
                with: expect.any(Function),
            },
            Buffer.from(createBinaryJsonSnapshot(makeParseResult()), "utf8"),
        );
    });

    it("preserves the original URI scheme when writing JSON snapshots", async () => {
        const remoteUri = {
            fsPath: "/workspace/test.pro",
            path: "/workspace/test.pro",
            scheme: "vscode-remote",
            authority: "ssh-remote+example",
            toString: () => "vscode-remote://ssh-remote+example/workspace/test.pro",
            with: ({ path }: { path: string }) => ({
                fsPath: path,
                path,
                scheme: "vscode-remote",
                authority: "ssh-remote+example",
                toString: () => `vscode-remote://ssh-remote+example${path}`,
            }),
        } as any;
        getConfiguration.mockReturnValue({
            get: vi.fn().mockReturnValue(true),
        });

        await saveBinaryDocumentArtifacts(remoteUri, remoteUri, bytes, makeParseResult());

        expect(writeFile).toHaveBeenNthCalledWith(
            2,
            {
                fsPath: "/workspace/test.pro.json",
                path: "/workspace/test.pro.json",
                scheme: "vscode-remote",
                authority: "ssh-remote+example",
                toString: expect.any(Function),
            },
            Buffer.from(createBinaryJsonSnapshot(makeParseResult()), "utf8"),
        );
    });
});
