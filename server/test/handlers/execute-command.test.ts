/**
 * Tests for handlers/execute-command.ts argument guards.
 *
 * A client may send a command with an empty `arguments` array, so the first argument is absent; every
 * branch must treat that as an invalid uri rather than throw reading `.uri` off it.
 */

import { describe, expect, it, vi } from "vitest";
import type { Connection, TextDocuments } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { VSCODE_COMMAND_COMPILE } from "@bgforge/shared/protocol";
import type { HandlerContext } from "../../src/handlers/context";

const mockConlog = vi.fn();
vi.mock("../../src/logger", () => ({
    conlog: (...args: unknown[]) => mockConlog(...args),
}));

const mockShowInfo = vi.fn();
vi.mock("../../src/user-messages", () => ({
    showInfo: (...args: unknown[]) => mockShowInfo(...args),
}));

import { register } from "../../src/handlers/execute-command";

type ExecuteCommandHandler = (params: { command: string; arguments?: unknown[] }, token: unknown) => unknown;

// The casts stand in for the connection, document store and context: the guard under test reads none of
// their other members.
function wireHandler(): ExecuteCommandHandler {
    let wired: ExecuteCommandHandler | undefined;
    const connection = {
        onExecuteCommand: (handler: ExecuteCommandHandler) => {
            wired = handler;
        },
    } as unknown as Connection;
    const documents = { get: () => undefined } as unknown as TextDocuments<TextDocument>;
    register({ connection, documents, timingOpts: { warn: () => {}, thresholdMs: 50 } } as unknown as HandlerContext);
    if (!wired) throw new Error("register() did not wire connection.onExecuteCommand");
    return wired;
}

describe("execute-command handler", () => {
    it("treats a compile command with an empty arguments array as an invalid uri", async () => {
        const handler = wireHandler();

        const result = await handler({ command: VSCODE_COMMAND_COMPILE, arguments: [] }, undefined);

        expect(result).toBeUndefined();
        expect(mockConlog).toHaveBeenCalledWith("Compile: invalid non-file uri 'undefined'");
        expect(mockShowInfo).toHaveBeenCalledWith("Focus a valid file to run commands!");
    });
});
