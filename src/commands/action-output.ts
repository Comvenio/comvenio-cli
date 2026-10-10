// Output of `comvenio action call|show` (K16, community-hub 14): the input
// fields of an action, the confirm command with the same idempotency key and
// screenshots saved as files instead of being dropped.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { ConnectorImage, ConnectorTool } from "../mcp/client.ts";

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

export interface InputField {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface InputVariant {
  /** Value of `operation` for grouped actions, otherwise null. */
  operation: string | null;
  fields: InputField[];
}

function typeOf(schema: Json): string {
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  const options = (schema.anyOf ?? schema.oneOf) as unknown;
  if (Array.isArray(options)) return options.map((option) => typeOf(object(option) ?? {})).join(" | ");
  return "beliebig";
}

/**
 * The fields of an action input from the tool's JSON schema. Actions wrap
 * their input as { input, idempotency_key }; grouped actions are a union over
 * `operation`, one variant per operation.
 */
export function inputVariants(inputSchema: unknown): InputVariant[] {
  const root = object(inputSchema) ?? {};
  const input = object(object(root.properties)?.input) ?? root;
  const options = (input.oneOf ?? input.anyOf) as unknown;
  const variants = Array.isArray(options) ? options.map(object).filter((v): v is Json => v !== null) : [input];
  return variants.map((variant) => {
    const properties = object(variant.properties) ?? {};
    const required = new Set(Array.isArray(variant.required) ? variant.required.filter((n) => typeof n === "string") : []);
    const operationSchema = object(properties.operation);
    const operation = typeof operationSchema?.const === "string" ? operationSchema.const : null;
    const fields = Object.entries(properties)
      .filter(([name]) => !(operation !== null && name === "operation"))
      .map(([name, schema]) => {
        const field = object(schema) ?? {};
        return {
          name,
          type: typeOf(field),
          required: required.has(name),
          description: typeof field.description === "string" ? field.description : null,
        };
      });
    return { operation, fields };
  });
}

export function formatActionDescription(actionId: string, tool: ConnectorTool): string {
  const lines = [`${actionId}${tool.title ? ` — ${tool.title}` : ""}`];
  if (tool.description) lines.push("", tool.description);
  const variants = inputVariants(tool.inputSchema);
  lines.push("", "Eingabe (--input, JSON-Objekt):");
  for (const variant of variants) {
    if (variant.operation !== null) lines.push("", `  "operation": "${variant.operation}"`);
    if (variant.fields.length === 0) {
      lines.push("    (keine weiteren Felder)");
      continue;
    }
    for (const field of variant.fields) {
      const mark = field.required ? "Pflicht" : "optional";
      lines.push(`    ${field.name} (${field.type}, ${mark})${field.description ? ` — ${field.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Text output of `action call`: the answer, then the idempotency key and —
 * for a critical write — the complete confirm command with the SAME key.
 * A different key on confirm is CONFIRMATION_MISMATCH (K16).
 */
export function formatCallText(result: Json, idempotencyKey: string | undefined): string {
  const lines = [JSON.stringify(result, null, 2)];
  const confirmation = object(result.confirmation);
  const key = typeof confirmation?.idempotency_key === "string" ? confirmation.idempotency_key : idempotencyKey;
  if (
    confirmation
    && typeof confirmation.preview_id === "string"
    && typeof confirmation.confirmation_token === "string"
    && key
  ) {
    lines.push(
      "",
      "Bestätigen (derselbe Idempotenzschlüssel wie beim Aufruf):",
      `  comvenio action confirm --preview-id ${confirmation.preview_id} `
        + `--confirmation-token=${confirmation.confirmation_token} --idempotency-key ${key}`,
    );
  } else if (key) {
    lines.push("", `Idempotenzschlüssel: ${key} (bei einer Wiederholung unverändert mit --idempotency-key angeben)`);
  }
  return lines.join("\n");
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function fileStem(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/u.test(value) ? value : null;
}

/**
 * Screenshots of an answer (MCP image content, K16). Without `dir` nothing is
 * written — a read stays a read — and the answer names the option. With `dir`
 * every call gets its own folder `<dir>/<preview>-<time>/`; files are created
 * exclusively (never overwritten, never through an existing link). Entries
 * marked `data_in_content` name their `file` only if the number of images
 * matches; otherwise the files are listed with a warning.
 */
export function saveScreenshots(
  result: Json,
  images: readonly ConnectorImage[],
  options: { cwd: string; dir?: string; now?: Date },
): Json {
  if (images.length === 0) return result;
  if (!options.dir) {
    return {
      ...result,
      screenshots_not_saved: `${images.length} Bild(er) in der Antwort; mit --screenshots <ordner> als Dateien speichern.`,
    };
  }
  const inner = object(result.result) ?? {};
  const entries = Array.isArray(inner.screenshots) ? inner.screenshots : [];
  const marked = entries.filter((value) => object(value)?.data_in_content === true).length;
  const time = (options.now ?? new Date()).toISOString().replace(/[:.]/gu, "-");
  const folder = join(resolve(options.cwd, options.dir), `${fileStem(inner.preview_id) ?? "screenshots"}-${time}`);
  mkdirSync(folder, { recursive: true });

  const files = images.map((image, index) => {
    const path = join(folder, `${index + 1}.${EXTENSIONS[image.mime_type] ?? "bin"}`);
    writeFileSync(path, Buffer.from(image.data, "base64"), { flag: "wx" });
    return relative(options.cwd, path);
  });
  if (marked !== images.length) {
    return {
      ...result,
      screenshot_files: files,
      screenshot_warning: `${images.length} Bild(er), aber ${marked} markierte Einträge — Zuordnung nicht eindeutig, Dateien in Reihenfolge der Antwort.`,
    };
  }
  let next = 0;
  const screenshots = entries.map((value) => {
    const entry = object(value);
    if (!entry || entry.data_in_content !== true) return value;
    const { data_in_content: _shown, ...rest } = entry;
    return { ...rest, file: files[next++] };
  });
  return { ...result, result: { ...inner, screenshots }, screenshot_files: files };
}
