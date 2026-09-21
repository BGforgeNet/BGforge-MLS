/**
 * The imported half of the number-literals fixture. Its only job is to make the entries beside it bundle:
 * a file with no imports skips the bundler, and the defect lives in the bundler's number printing.
 * The value itself is round, so the imported binding is exercised too.
 */

export const LIMIT = 5000;
