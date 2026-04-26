import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { showErrorMessage, outputAppendLine } = vi.hoisted(() => ({
    showErrorMessage: vi.fn(),
    outputAppendLine: vi.fn(),
}));

vi.mock("vscode", () => ({
    window: {
        showErrorMessage,
        createOutputChannel: () => ({
            appendLine: outputAppendLine,
            dispose: vi.fn(),
        }),
    },
}));

import * as logging from "../src/logging";
import { surfaceWebviewRuntimeError } from "../src/webview-error";

describe("surfaceWebviewRuntimeError", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let conlogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        showErrorMessage.mockReset();
        outputAppendLine.mockReset();
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        conlogSpy = vi.spyOn(logging, "conlog").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        conlogSpy.mockRestore();
    });

    test("logs the runtime error to the conlog output channel at error level", () => {
        surfaceWebviewRuntimeError({
            label: "Binary editor for foo.pro",
            userFacingFile: "foo.pro",
            message: "boom",
            stack: "at line 42",
        });

        expect(conlogSpy).toHaveBeenCalledWith(expect.stringContaining("Binary editor for foo.pro"), "error");
        expect(conlogSpy.mock.calls[0]?.[0]).toContain("boom");
        expect(conlogSpy.mock.calls[0]?.[0]).toContain("at line 42");
    });

    test("logs to console.error with stack for Developer Tools", () => {
        surfaceWebviewRuntimeError({
            label: "Dialog preview for x.ssl",
            userFacingFile: "x.ssl",
            message: "oops",
            stack: "stack trace",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Dialog preview for x.ssl"),
            "stack trace",
        );
    });

    test("calls showErrorMessage with the user-facing filename and the error message", () => {
        surfaceWebviewRuntimeError({
            label: "Binary editor for foo.pro",
            userFacingFile: "foo.pro",
            message: "kaput",
        });

        expect(showErrorMessage).toHaveBeenCalledTimes(1);
        const arg = showErrorMessage.mock.calls[0]?.[0] as string;
        expect(arg).toContain("foo.pro");
        expect(arg).toContain("kaput");
    });

    test("tolerates undefined stack", () => {
        expect(() =>
            surfaceWebviewRuntimeError({
                label: "Binary editor for foo.pro",
                userFacingFile: "foo.pro",
                message: "boom",
            }),
        ).not.toThrow();
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(conlogSpy).toHaveBeenCalled();
    });
});
