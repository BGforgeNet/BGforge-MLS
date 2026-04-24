/**
 * Shared vitest setup for integration tests.
 *
 * Mocks the LSP connection module so that provider code importing
 * lsp-connection doesn't fail outside a real LSP session.
 */

import { vi } from "vitest";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));
