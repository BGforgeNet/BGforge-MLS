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

/**
 * A minimal classic `dialog.tlk` holding one string, written in the given codepage.
 *
 * Header is 18 bytes (signature, version, language id, entry count, string-data offset) and each entry is 26,
 * which is what puts the first entry at 0x12 and its string offset/length at +0x12/+0x16 within it.
 */
function writeTlk(dir: string, text: string, encoding: BufferEncoding | "cp1251"): void {
    // Node has no cp1251 encoder; the two characters used below sit at known single-byte positions in it.
    const CP1251: Record<string, number> = { "\u041F": 0xcf, "\u0440": 0xf0 };
    const bytes =
        encoding === "cp1251"
            ? Buffer.from([...text].map((c) => CP1251[c] ?? c.codePointAt(0) ?? 0))
            : Buffer.from(text, encoding);
    const HEADER = 0x12;
    const ENTRY = 0x1a;
    const buf = Buffer.alloc(HEADER + ENTRY + bytes.length);
    buf.write("TLK V1  ", 0, "latin1");
    buf.writeUInt16LE(0, 8); // language id - present in every real file and meaningless; see the codec notes
    buf.writeUInt32LE(1, 10); // one entry
    buf.writeUInt32LE(HEADER + ENTRY, 14); // string data starts after the single entry
    buf.writeUInt16LE(1, HEADER); // entry type: has text
    buf.writeUInt32LE(0, HEADER + 0x12); // string offset, relative to the string data
    buf.writeUInt32LE(bytes.length, HEADER + 0x16);
    bytes.copy(buf, HEADER + ENTRY);
    fs.writeFileSync(path.join(dir, "dialog.tlk"), buf);
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
    /**
     * A classic install records its codepage nowhere: the TLK header's language id is meaningless (0 in every
     * file checked, and both reference implementations read it without ever consuming it), so "windows ANSI"
     * defaults to cp1252 and is simply wrong for the languages that do not use it. The setting is the only way
     * a Russian or Polish classic install reads correctly, which is why it exists.
     */
    it("decodes the string table in the configured encoding", () => {
        const dir = tmpGame();
        writeTlk(dir, "\u041F\u0440", "cp1251");

        const session = new GameSession(() => "windows-1251");

        expect(session.open(dir).tlk()?.get(0)).toBe("\u041F\u0440");
    });

    // The default has to stay exactly what it was, or every Western classic install changes meaning at once.
    it("falls back to cp1252 for a classic game with no configured encoding", () => {
        const dir = tmpGame();
        writeTlk(dir, "\u041F\u0440", "cp1251");

        const session = new GameSession();

        // cp1252 reads those two bytes as different characters - wrong, but unchanged from before the setting.
        expect(session.open(dir).tlk()?.get(0)).toBe("\u00CF\u00F0");
    });

    // Both entry points open games, so a setting honoured by only one is a setting that works intermittently.
    it("applies the configured encoding through ensureOpen as well as open", () => {
        const dir = tmpGame();
        writeTlk(dir, "\u041F\u0440", "cp1251");

        const session = new GameSession(() => "windows-1251");

        expect(session.ensureOpen(dir).tlk()?.get(0)).toBe("\u041F\u0440");
    });

    // Read per open, not captured once, so fixing the setting does not need a window reload.
    it("re-reads the encoding on each open rather than caching the first answer", () => {
        const dir = tmpGame();
        writeTlk(dir, "\u041F\u0440", "cp1251");
        const configured: { value: string | undefined } = { value: undefined };
        const session = new GameSession(() => configured.value);

        expect(session.open(dir).tlk()?.get(0)).toBe("\u00CF\u00F0");
        configured.value = "windows-1251";
        session.close(dir);

        expect(session.open(dir).tlk()?.get(0)).toBe("\u041F\u0440");
    });
});

/**
 * The setting's values are handed straight to `TextDecoder`, which throws a RangeError on a label it does not
 * know - so an enum entry that looks right and is not (`windows-932` for Japanese, where the accepted label is
 * `shift_jis`) fails at the moment a user picks it, in the one install that needed the setting at all.
 */
describe("the tlkEncoding setting's values", () => {
    it("offers only labels TextDecoder accepts", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
            contributes: { configuration: { properties: Record<string, { enum?: string[] }> } };
        };
        const values = manifest.contributes.configuration.properties["bgforge.weidu.tlkEncoding"]?.enum;

        expect(values, "the setting is missing from package.json").toBeDefined();
        const rejected = values!.filter((label) => {
            if (label === "") return false; // the automatic default, never handed to a decoder
            try {
                // Constructed only to see whether the label is accepted; the decoder itself is not needed.
                void new TextDecoder(label).encoding;
                return false;
            } catch {
                return true;
            }
        });

        expect(rejected).toEqual([]);
    });
});
