import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { validate } from "../src/validate";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function openSessionForFixture() {
    const { sessionId } = openSession("file:///arcaves.map", new Uint8Array(fs.readFileSync(MAP_FIXTURE)));
    const session = sessionStore.get(sessionId);
    expect(session).toBeDefined();
    return session;
}

describe("validate", () => {
    it("returns no diagnostics for a clean map", () => {
        const session = openSessionForFixture();
        if (!session) return;
        expect(validate(session)).toEqual([]);
    });

    it("never throws", () => {
        const session = openSessionForFixture();
        if (!session) return;
        expect(() => validate(session)).not.toThrow();
    });
});
