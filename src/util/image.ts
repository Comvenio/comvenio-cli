// Image helper for `menu generate --photo` / `menu design --photo`.
// Reads a local image file and returns raw base64 (NO `data:` prefix) + the MIME
// type derived from the extension. The ai-service calls
// base64.b64decode(..., validate=True) + validate_image_bytes — a `data:` prefix
// would make it 400 (Sub-File 08 § 4 "Bild-Aufbereitung").
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Read a local image file → [base64, mime]. base64 carries NO `data:` prefix.
 * Throws a descriptive Error on a missing file or an unsupported extension —
 * the caller turns it into a clean stderr message + non-zero exit code.
 */
export function readImageAsBase64(path: string): [string, string] {
  if (!existsSync(path)) {
    throw new Error(`Bild-Datei nicht gefunden: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(
      `Nicht unterstuetztes Bildformat "${ext}". Erlaubt: ${Object.keys(MIME_BY_EXT).join(", ")}`,
    );
  }
  const bytes = readFileSync(path);
  // Buffer.toString("base64") — raw base64, no `data:` prefix.
  return [bytes.toString("base64"), mime];
}
