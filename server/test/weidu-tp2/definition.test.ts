/**
 * Unit tests for WeiDU TP2 variable go-to-definition functionality.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pathToFileURL } from "url";
import { CompletionItemKind, Position } from "vscode-languageserver/node";
import { SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDefinition } from "../../src/weidu-tp2/definition";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { parseFile } from "../../src/weidu-tp2/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { Symbols } from "../../src/core/symbol-index";
import { normalizeUri } from "../../src/core/normalized-uri";

beforeAll(async () => {
    await initParser();
});

describe("TP2 definition: file-scope variables", () => {
    it("finds OUTER_SET definition from usage", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const uri = "file:///test.tp2";
        // Cursor on "my_var" in %my_var%
        const position: Position = { line: 2, character: 20 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10); // "my_var" in declaration
    });

    it("finds OUTER_TEXT_SPRINT definition from usage", () => {
        const text = `
OUTER_TEXT_SPRINT mod_folder ~mymod~
COPY ~%mod_folder%/file.txt~ ~override~
`;
        const uri = "file:///test.tp2";
        // Cursor on "mod_folder" in %mod_folder%
        const position: Position = { line: 2, character: 9 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(18); // "mod_folder" in declaration
    });

    it("finds bare assignment definition", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    x = 123
    PATCH_PRINT ~%x%~
`;
        const uri = "file:///test.tp2";
        // Cursor on "x" in %x%
        const position: Position = { line: 3, character: 19 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(2);
        expect(result?.range.start.character).toBe(4); // "x" in declaration
    });
});

describe("TP2 definition: function-scope variables", () => {
    it("finds SET definition inside function", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR param = 0
BEGIN
    SET local_var = param + 1
    PATCH_PRINT ~local_var = %local_var%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "local_var" in %local_var%
        const position: Position = { line: 5, character: 31 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(4);
        expect(result?.range.start.character).toBe(8); // "local_var" in SET
    });

    it("finds INT_VAR parameter definition from usage", () => {
        const text = `
DEFINE_PATCH_FUNCTION AddItem
    INT_VAR count = 1
BEGIN
    SET total = count * 2
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "count" in expression
        const position: Position = { line: 4, character: 16 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(2);
        expect(result?.range.start.character).toBe(12); // "count" parameter
    });

    it("finds STR_VAR parameter definition", () => {
        const text = `
DEFINE_ACTION_FUNCTION PrintMessage
    STR_VAR message = ~default~
BEGIN
    ACTION_PRINT ~%message%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "message" in %message%
        const position: Position = { line: 4, character: 20 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(2);
        expect(result?.range.start.character).toBe(12); // "message" parameter
    });
});

describe("TP2 definition: shadowing", () => {
    it("finds function-local variable when shadowing file-level", () => {
        const text = `
OUTER_SET x = 100
DEFINE_PATCH_FUNCTION Test
BEGIN
    SET x = 5
    PATCH_PRINT ~%x%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "x" in %x% inside function
        const position: Position = { line: 5, character: 19 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should find the function-local SET, not the OUTER_SET
        expect(result?.range.start.line).toBe(4);
        expect(result?.range.start.character).toBe(8);
    });
});

describe("TP2 definition: loop variables", () => {
    it("finds FOR_EACH loop variable definition", () => {
        const text = `
ACTION_DEFINE_ARRAY colors BEGIN ~red~ ~green~ ~blue~ END

ACTION_FOR_EACH color IN colors BEGIN
    OUTER_SPRINT msg ~Color: %color%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "color" in %color%
        const position: Position = { line: 4, character: 31 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(3);
        expect(result?.range.start.character).toBe(16); // "color" in FOR_EACH
    });

    it("finds PHP_EACH key variable definition", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT msg ~%potion%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "potion" in %potion%
        const position: Position = { line: 6, character: 24 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(5);
        expect(result?.range.start.character).toBe(33); // "potion" in AS clause
    });

    it("finds PHP_EACH value variable definition", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT msg ~%string%~
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "string" in %string%
        const position: Position = { line: 6, character: 24 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(5);
        expect(result?.range.start.character).toBe(43); // "string" after => (starts at 's')
    });

    it("finds PATCH_FOR_EACH loop variable definition", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    DEFINE_ARRAY items BEGIN ~sword~ ~axe~ END
    PATCH_FOR_EACH item IN items BEGIN
        PATCH_PRINT ~%item%~
    END
`;
        const uri = "file:///test.tp2";
        // Cursor on "item" in %item%
        const position: Position = { line: 4, character: 23 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(3);
        expect(result?.range.start.character).toBe(19); // "item" in PATCH_FOR_EACH
    });
});

describe("TP2 definition: %var% in strings", () => {
    it("finds definition for variable in tilde string", () => {
        const text = `
OUTER_SET count = 5
PRINT ~Total: %count%~
`;
        const uri = "file:///test.tp2";
        // Cursor on "count" inside %count%
        const position: Position = { line: 2, character: 17 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10);
    });

    it("finds definition for variable in five-tilde string", () => {
        const text = `
OUTER_SET potion = 123
OUTER_SPRINT msg
~~~~~
Use potion %potion%
~~~~~
`;
        const uri = "file:///test.tp2";
        // Cursor on "potion" in %potion% inside five-tilde string
        const position: Position = { line: 4, character: 15 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10);
    });
});

describe("TP2 definition: no definition found", () => {
    it("returns null for undefined variable", () => {
        const text = `
OUTER_SET result = %undefined_var% + 1
`;
        const uri = "file:///test.tp2";
        // Cursor on "undefined_var"
        const position: Position = { line: 1, character: 21 };
        const result = getDefinition(text, uri, position);

        expect(result).toBeNull();
    });

    it("returns null for external variable from INCLUDE", () => {
        const text = `
// external_var is defined in another file
OUTER_SET result = %external_var% + 1
`;
        const uri = "file:///test.tp2";
        // Cursor on "external_var"
        const position: Position = { line: 2, character: 21 };
        const result = getDefinition(text, uri, position);

        // Should return null since variable is not defined in this file
        expect(result).toBeNull();
    });
});

describe("TP2 definition: cross-context (patch to action)", () => {
    it("finds READ_ASCII definition from OUTER_SPRINT outside COPY_EXISTING", () => {
        const text = `
ACTION_PHP_EACH familiar_list AS cre => item BEGIN
  ACTION_IF FILE_EXISTS_IN_GAME ~%cre%.cre~ BEGIN
    COPY_EXISTING ~%cre%.cre~ ~override~
      READ_ASCII SCRIPT_OVERRIDE over_script
      PATCH_IF FILE_EXISTS_IN_GAME ~%over_script%.bcs~ BEGIN
        over_exists = 1
      END ELSE BEGIN
        over_exists = 0
      END
    BUT_ONLY

    ACTION_IF over_exists == 0 BEGIN
      OUTER_SPRINT over_script ~new_script~
    END
  END
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "over_script" in OUTER_SPRINT (line 13)
        // Line 13: "      OUTER_SPRINT over_script ~new_script~"
        const position: Position = { line: 13, character: 20 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should find READ_ASCII definition on line 4
        expect(result?.range.start.line).toBe(4);
    });

    it("finds READ_ASCII definition from usage in string outside COPY_EXISTING", () => {
        const text = `
COPY_EXISTING ~file.cre~ ~override~
  READ_ASCII SCRIPT_OVERRIDE over_script
BUT_ONLY

PRINT ~Script is %over_script%~
`;
        const uri = "file:///test.tp2";
        // Cursor on "over_script" in %over_script% (line 5)
        const position: Position = { line: 5, character: 20 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should find READ_ASCII definition on line 2
        expect(result?.range.start.line).toBe(2);
    });
});

describe("TP2 definition: case sensitivity", () => {
    it("matches variable names with exact case", () => {
        const text = `
OUTER_SET myvar = 10
OUTER_SET result = %myvar% + 1
`;
        const uri = "file:///test.tp2";
        // Cursor on "myvar" in usage
        const position: Position = { line: 2, character: 21 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10);
    });

    it("does not match variable names with different case", () => {
        const text = `
OUTER_SET MyVar = 10
OUTER_SET result = %myvar% + 1
`;
        const uri = "file:///test.tp2";
        // Cursor on "myvar" (lowercase) - should NOT find "MyVar" (mixed case)
        const position: Position = { line: 2, character: 21 };
        const result = getDefinition(text, uri, position);

        expect(result).toBeNull();
    });
});

describe("TP2 definition: function call parameters", () => {
    it("navigates to function definition when cursor is on function call parameter name", () => {
        const text = `OUTER_SET foo = 5
DEFINE_ACTION_FUNCTION my_func INT_VAR foo = 0 BEGIN
END
LAF my_func INT_VAR foo = 1 END
`;
        const uri = "file:///test.tp2";
        // Cursor on "foo" in LAF call's INT_VAR section (line 3, character 21)
        const position: Position = { line: 3, character: 21 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should navigate to the function definition (line 1)
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(23); // "my_func" in DEFINE_ACTION_FUNCTION
    });

    it("navigates to function definition from LPF INT_VAR parameter in call", () => {
        const text = `DEFINE_PATCH_FUNCTION test_func INT_VAR count = 0 BEGIN
END
COPY_EXISTING ~foo.itm~ ~override~
    LPF test_func INT_VAR count = 5 END
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "count" in LPF call (line 3, character 26)
        const position: Position = { line: 3, character: 26 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should navigate to the function definition
        expect(result?.range.start.line).toBe(0);
        expect(result?.range.start.character).toBe(22); // "test_func" in DEFINE_PATCH_FUNCTION
    });

    it("navigates to variable definition when cursor is on call argument value", () => {
        const text = `OUTER_SET test2 = 5
LAF my_func INT_VAR bonus = test2 END
`;
        const uri = "file:///test.tp2";
        // Cursor on "test2" in the value position (after =), line 1, character 28
        const position: Position = { line: 1, character: 28 };
        const result = getDefinition(text, uri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        // Should navigate to the variable definition (line 0, "test2" in OUTER_SET)
        expect(result?.range.start.line).toBe(0);
    });

    it("returns null for param name when function is not indexed", () => {
        // Set up a Symbols with a variable having the same name as the parameter
        const mockSymbols = new Symbols();
        const headerUri = "file:///lib.tph";
        const headerText = `
OUTER_SET parameter2 = 999
`;
        const symbols = parseHeaderToSymbols(headerUri, headerText);
        mockSymbols.updateFile(normalizeUri(headerUri), symbols);

        // Call an unknown function with a parameter that matches the indexed variable
        const text = `LPF unknown_func
    INT_VAR
        parameter2 = 1
END
`;
        const uri = "file:///test.tp2";
        // Cursor on "parameter2" in the call (line 2, character 10)
        const position: Position = { line: 2, character: 10 };
        const result = getDefinition(text, uri, position, mockSymbols);

        // Should return null, NOT the variable definition from the index
        expect(result).toBeNull();
    });
});

describe("TP2 definition: INCLUDE directive", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp2-include-test-"));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("navigates to included file when it exists", () => {
        // Create target file
        const libDir = path.join(tempDir, "lib");
        fs.mkdirSync(libDir, { recursive: true });
        const targetPath = path.join(libDir, "utils.tph");
        fs.writeFileSync(targetPath, "// Header file");

        // Main file with INCLUDE
        const mainPath = path.join(tempDir, "setup.tp2");
        const mainUri = pathToFileURL(mainPath).toString();
        const text = `INCLUDE ~lib/utils.tph~`;

        // Cursor on the path string (middle of "lib/utils.tph")
        const position: Position = { line: 0, character: 12 };
        const result = getDefinition(text, mainUri, position);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(pathToFileURL(targetPath).toString());
        expect(result?.range.start.line).toBe(0);
        expect(result?.range.start.character).toBe(0);
    });

    it("returns null when included file does not exist", () => {
        const mainPath = path.join(tempDir, "setup.tp2");
        const mainUri = pathToFileURL(mainPath).toString();
        const text = `INCLUDE ~nonexistent/file.tph~`;

        const position: Position = { line: 0, character: 15 };
        const result = getDefinition(text, mainUri, position);

        expect(result).toBeNull();
    });

    it("returns null when cursor is not on INCLUDE path", () => {
        const text = `
OUTER_SET x = 5
INCLUDE ~lib/file.tph~
`;
        const uri = "file:///test.tp2";
        // Cursor on "x" in OUTER_SET, not on INCLUDE
        const position: Position = { line: 1, character: 12 };
        const result = getDefinition(text, uri, position);

        // Should find variable definition, not navigate to a file
        // Result is null because 'x' is being defined, not used
        expect(result).toBeNull();
    });
});

describe("TP2 definition: header variables", () => {
    it("finds header variable definition from local usage", () => {
        const text = `
// Local file uses %test_var% which is defined in a header
OUTER_SET result = %test_var% + 1
`;
        const uri = "file:///local.tp2";
        const headerUri = "file:///header.tph";

        // Setup: simulate header file with OUTER_SET test_var = 100
        const headerText = `
OUTER_SET test_var = 100
`;
        // Populate the Symbols as if header file was indexed
        const mockSymbols = new Symbols();
        const symbols = parseHeaderToSymbols(headerUri, headerText);
        mockSymbols.updateFile(normalizeUri(headerUri), symbols);

        // Cursor on "test_var" in %test_var%
        const position: Position = { line: 2, character: 21 };
        const result = getDefinition(text, uri, position, mockSymbols);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(headerUri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10); // "test_var" in OUTER_SET
    });

    it("prefers header definition over local reassignment", () => {
        const text = `
// Local file: my_var is defined in header, reassigned locally
my_var = 2
OUTER_SET result = %my_var% + 1
`;
        const uri = "file:///local.tp2";
        const headerUri = "file:///header.tph";

        // Setup: simulate header file with OUTER_SET my_var = 1
        const mockSymbols = new Symbols();
        const headerText = `
OUTER_SET my_var = 1
`;
        const symbols = parseHeaderToSymbols(headerUri, headerText);
        mockSymbols.updateFile(normalizeUri(headerUri), symbols);

        // Cursor on "my_var" in %my_var%
        const position: Position = { line: 3, character: 21 };
        const result = getDefinition(text, uri, position, mockSymbols);

        expect(result).not.toBeNull();
        // Should point to header definition, not local reassignment
        expect(result?.uri).toBe(headerUri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10); // "my_var" in OUTER_SET
    });

    it("finds local definition when no header variable exists", () => {
        const text = `
OUTER_SET local_var = 42
OUTER_SET result = %local_var% + 1
`;
        const uri = "file:///test.tp2";

        // No header setup - pass empty Symbols
        const mockSymbols = new Symbols();

        // Cursor on "local_var" in %local_var%
        const position: Position = { line: 2, character: 21 };
        const result = getDefinition(text, uri, position, mockSymbols);

        expect(result).not.toBeNull();
        expect(result?.uri).toBe(uri);
        expect(result?.range.start.line).toBe(1);
        expect(result?.range.start.character).toBe(10);
    });
});

describe("TP2 definition: static symbols", () => {
    it("returns null for static symbols with null location (prevents VSCode directory open)", () => {
        // Static symbols (built-in functions like ALTER_EFFECT) have no source file.
        // Their location is null, so definition should return null.
        const mockSymbols = new Symbols();
        mockSymbols.loadStatic([
            {
                name: "ALTER_EFFECT",
                kind: SymbolKind.Action,
                location: null, // Static symbols have no source file
                scope: { level: ScopeLevel.Global },
                source: { type: SourceType.Static, uri: null },
                completion: { label: "ALTER_EFFECT", kind: CompletionItemKind.Function },
                hover: { contents: { kind: "markdown", value: "Alters an effect" } },
                callable: {},
            },
        ]);

        const text = `COPY_EXISTING ~spell.spl~ ~override~
    LPF ALTER_EFFECT END
END`;
        const uri = "file:///test.tp2";
        // Cursor on "ALTER_EFFECT" in LPF call
        const position: Position = { line: 1, character: 10 };
        const result = getDefinition(text, uri, position, mockSymbols);

        // Should return null, NOT a location with empty URI
        expect(result).toBeNull();
    });

    it("returns valid location for header functions with real URIs", () => {
        // Header functions have real URIs and should work normally
        const mockSymbols = new Symbols();
        const headerUri = "file:///lib/functions.tph";
        const headerText = `
DEFINE_PATCH_FUNCTION my_patch_func
BEGIN
END
`;
        const symbols = parseHeaderToSymbols(headerUri, headerText);
        mockSymbols.updateFile(normalizeUri(headerUri), symbols);

        const text = `COPY_EXISTING ~item.itm~ ~override~
    LPF my_patch_func END
END`;
        const uri = "file:///test.tp2";
        // Cursor on "my_patch_func"
        const position: Position = { line: 1, character: 10 };
        const result = getDefinition(text, uri, position, mockSymbols);

        // Should return the header location
        expect(result).not.toBeNull();
        expect(result?.uri).toBe(headerUri);
    });
});
