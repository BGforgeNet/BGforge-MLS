import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { serializeSession } from "../src/serialize";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

describe("serializeSession", () => {
    it("round-trips an unedited map byte-for-byte", () => {
        const original = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const { sessionId } = openSession("file:///arcaves.map", original);
        const session = sessionStore.get(sessionId);
        expect(session).toBeDefined();
        if (!session) return;
        const out = serializeSession(session);
        expect(Buffer.from(out).equals(Buffer.from(original))).toBe(true);
    });
});
