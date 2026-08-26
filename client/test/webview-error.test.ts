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
            editor: "Binary editor",
            file: "foo.pro",
            message: "boom",
            stack: "at line 42",
        });

        expect(conlogSpy).toHaveBeenCalledWith(expect.stringContaining("Binary editor for foo.pro"), "error");
        expect(conlogSpy.mock.calls[0]?.[0]).toContain("boom");
        expect(conlogSpy.mock.calls[0]?.[0]).toContain("at line 42");
    });

    test("logs to console.error with stack for Developer Tools", () => {
        surfaceWebviewRuntimeError({
            editor: "Dialog editor",
            file: "x.ssl",
            message: "oops",
            stack: "stack trace",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Dialog editor for x.ssl"), "stack trace");
    });

    test("calls showErrorMessage with the user-facing filename and the error message", () => {
        surfaceWebviewRuntimeError({
            editor: "Binary editor",
            file: "foo.pro",
            message: "kaput",
        });

        expect(showErrorMessage).toHaveBeenCalledTimes(1);
        const arg = showErrorMessage.mock.calls[0]?.[0] as string;
        expect(arg).toBe("Binary editor failed for foo.pro: kaput");
        // The file appears ONCE. It was in the toast twice while callers folded it into the label as well,
        // which is what splitting the two fields is for.
        expect(arg.split("foo.pro")).toHaveLength(2);
    });

    test("tolerates undefined stack", () => {
        expect(() =>
            surfaceWebviewRuntimeError({
                editor: "Binary editor",
                file: "foo.pro",
                message: "boom",
            }),
        ).not.toThrow();
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(conlogSpy).toHaveBeenCalled();
    });
});
