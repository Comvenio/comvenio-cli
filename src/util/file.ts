// Small file helpers for the declarative KI-Gen modes (menu apply / homepage apply).
// readJsonFile reads + parses a UTF-8 JSON file; errors are AuthError-free plain
// Errors so main() reports them on stderr with exit code 1.
import { readFileSync, existsSync } from "node:fs";

/**
 * Read + parse a JSON file. Throws a descriptive Error when the file is missing
 * or is not valid JSON — the caller (a *_apply command) turns this into a clean
 * stderr message + non-zero exit code.
 */
export function readJsonFile<T = unknown>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Datei nicht gefunden: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`Datei konnte nicht gelesen werden: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Kein gueltiges JSON in ${path}: ${(err as Error).message}`);
  }
}
