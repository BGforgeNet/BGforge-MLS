import type { BinaryParser, GameFamily } from "./types";

/**
 * Registry for binary file parsers.
 * Parsers register themselves and can be looked up by extension.
 */
class ParserRegistry {
    private parsers: Map<string, BinaryParser> = new Map();
    /**
     * Extension -> parser ids, in registration order. A LIST because the two game families legitimately claim
     * the same extension (`.pro`), so a collision across families is not a mistake and must not drop either
     * parser; `family` is what tells them apart.
     */
    private extensionMap: Map<string, string[]> = new Map();

    /**
     * Register a parser
     */
    register(parser: BinaryParser): void {
        if (this.parsers.has(parser.id)) {
            // Silent last-wins would let a duplicate id shadow the first registration for every
            // subsequent lookup by id or extension; a library consumer needs that to fail loudly
            // rather than losing a parser without any indication why.
            throw new Error(`Parser "${parser.id}" is already registered`);
        }
        if (parser.extensions.length === 0) {
            console.warn(`Parser "${parser.id}" has no extensions registered`);
        }
        this.parsers.set(parser.id, parser);
        for (const ext of parser.extensions) {
            const extLower = ext.toLowerCase();
            const ids = this.extensionMap.get(extLower);
            if (ids === undefined) {
                this.extensionMap.set(extLower, [parser.id]);
                continue;
            }
            // Two parsers of the SAME family on one extension is the ambiguity this warning has always been
            // about - nothing can tell them apart - so the later one still wins. Across families both are kept.
            const clash = ids.findIndex((id) => this.parsers.get(id)?.family === parser.family);
            if (clash === -1) {
                ids.push(parser.id);
                continue;
            }
            console.warn(
                `Extension ".${ext}" already registered by "${ids[clash]}" for the ${parser.family} family, ` +
                    `overwriting with "${parser.id}"`,
            );
            ids[clash] = parser.id;
        }
    }

    /**
     * Get parser by ID
     */
    getById(id: string): BinaryParser | undefined {
        return this.parsers.get(id);
    }

    /**
     * Get parser for a file extension, optionally restricted to one game family.
     *
     * Without a family this answers "some parser claims this extension", which is all a caller holding only a
     * file path can ask - and where the families collide it returns the first registered, which is a guess. A
     * caller that knows the family passes it and gets a parser that really reads that game's format.
     */
    getByExtension(extension: string, family?: GameFamily): BinaryParser | undefined {
        const ext = extension.toLowerCase().replace(/^\./, "");
        for (const id of this.extensionMap.get(ext) ?? []) {
            const parser = this.parsers.get(id);
            if (parser && (family === undefined || parser.family === family)) return parser;
        }
        return undefined;
    }

    /**
     * Get all registered extensions
     */
    getExtensions(): string[] {
        return [...this.extensionMap.keys()];
    }

    /**
     * Get all registered parsers
     */
    getAllParsers(): BinaryParser[] {
        return [...this.parsers.values()];
    }
}

export const parserRegistry = new ParserRegistry();
