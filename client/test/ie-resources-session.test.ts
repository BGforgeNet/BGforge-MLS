import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GameSession } from "../src/ie-resources/session";

// GameSession has no vscode dependency (it wraps @bgforge/binary's openGame), so it is unit-testable directly.
// Write a minimal valid chitin.key (header + 1 BIF entry + 2 resource entries + name) to a temp dir.
function writeMinimalGame(dir: string): void {
    const RES: [string, number, number][] = [
        ["SW1H01", 0x03ed, 0], // ITM
        ["SPWI304", 0x03ee, 1], // SPL
    ];
    const bifName = "data\\test.bif";
    const bifOffset = 24;
    const resOffset = bifOffset + 12;
    const nameOffset = resOffset + RES.length * 14;
    const buf = Buffer.alloc(nameOffset + bifName.length + 1);
    buf.write("KEY ", 0, "latin1");
    buf.write("V1  ", 4, "latin1");
    buf.writeUInt32LE(1, 8); // bifCount
    buf.writeUInt32LE(RES.length, 12); // resCount
    buf.writeUInt32LE(bifOffset, 16);
    buf.writeUInt32LE(resOffset, 20);
    buf.writeUInt32LE(0, bifOffset); // fileLength
    buf.writeUInt32LE(nameOffset, bifOffset + 4);
    buf.writeUInt16LE(bifName.length + 1, bifOffset + 8);
    buf.writeUInt16LE(0, bifOffset + 10);
    buf.write(bifName, nameOffset, "latin1");
    RES.forEach(([resref, type, fileIndex], i) => {
        const p = resOffset + i * 14;
        buf.write(resref, p, "latin1");
        buf.writeUInt16LE(type, p + 8);
        buf.writeUInt32LE(fileIndex & 0x3fff, p + 10);
    });
    fs.writeFileSync(path.join(dir, "chitin.key"), buf);
}

describe("GameSession", () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });
    function tmpGame(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ie-session-"));
        dirs.push(dir);
        writeMinimalGame(dir);
        return dir;
    }

    it("opens a game, exposes it as current, and resolves it by dir", () => {
        const session = new GameSession();
        const dir = tmpGame();
        const game = session.open(dir);
        expect(session.current?.dir).toBe(dir);
        expect(session.current?.game).toBe(game);
        expect(session.game(dir)).toBe(game);
        expect(
            game
                .list()
                .map((r) => r.resref)
                .sort(),
        ).toEqual(["SPWI304", "SW1H01"]);
        session.dispose();
    });

    it("close clears current and forgets the game; reopen restores it", () => {
        const session = new GameSession();
        const dir = tmpGame();
        session.open(dir);
        session.close();
        expect(session.current).toBeUndefined();
        expect(session.game(dir)).toBeUndefined();
        session.open(dir); // reopen the same dir
        expect(session.current?.dir).toBe(dir);
        session.dispose();
    });

    it("throws opening a dir without a chitin.key", () => {
        const session = new GameSession();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ie-empty-"));
        dirs.push(dir);
        expect(() => session.open(dir)).toThrow(/chitin\.key/);
        session.dispose();
    });

    it("ensureOpen opens a game on demand, is idempotent, and adopts current only when nothing is open", () => {
        const session = new GameSession();
        const a = tmpGame();
        const b = tmpGame();
        // First game opened via the view; it is current.
        const gameA = session.open(a);
        // ensureOpen on a DIFFERENT dir (as an FS-provider readback would after restore) opens it but must not
        // steal current from the already-open game.
        const gameB = session.ensureOpen(b);
        expect(session.game(b)).toBe(gameB);
        expect(session.current?.dir).toBe(a);
        // Idempotent: a second ensureOpen returns the same instance, no reopen.
        expect(session.ensureOpen(b)).toBe(gameB);
        expect(session.ensureOpen(a)).toBe(gameA);
        session.dispose();
    });

    it("ensureOpen adopts the game as current when the session has none open", () => {
        const session = new GameSession();
        const dir = tmpGame();
        const game = session.ensureOpen(dir);
        expect(session.current).toEqual({ dir, game });
        session.dispose();
    });
});
