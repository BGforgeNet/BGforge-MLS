import type { BinaryParser } from "./types";

/**
 * Registry for binary file parsers.
 * Parsers register themselves and can be looked up by extension.
 */
class ParserRegistry {
    private parsers: Map<string, BinaryParser> = new Map();
    private extensionMap: Map<string, string> = new Map();

    /**
     * Register a parser
     */
    register(parser: BinaryParser): void {
        if (parser.extensions.length === 0) {
            console.warn(`Parser "${parser.id}" has no extensions registered`);
        }
        this.parsers.set(parser.id, parser);
        for (const ext of parser.extensions) {
            const extLower = ext.toLowerCase();
            if (this.extensionMap.has(extLower)) {
                const existingId = this.extensionMap.get(extLower);
                console.warn(
                    `Extension ".${ext}" already registered by "${existingId}", overwriting with "${parser.id}"`,
                );
            }
            this.extensionMap.set(extLower, parser.id);
        }
    }

    /**
     * Get parser by ID
     */
    getById(id: string): BinaryParser | undefined {
        return this.parsers.get(id);
    }

    /**
     * Get parser for a file extension
     */
    getByExtension(extension: string): BinaryParser | undefined {
        const ext = extension.toLowerCase().replace(/^\./, "");
        const parserId = this.extensionMap.get(ext);
        if (parserId) {
            return this.parsers.get(parserId);
        }
        return undefined;
    }

    /**
     * Get all registered extensions
     */
    getExtensions(): string[] {
        return Array.from(this.extensionMap.keys());
    }

    /**
     * Get all registered parsers
     */
    getAllParsers(): BinaryParser[] {
        return Array.from(this.parsers.values());
    }
}

export const parserRegistry = new ParserRegistry();
