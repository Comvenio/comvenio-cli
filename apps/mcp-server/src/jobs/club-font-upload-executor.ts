import { createHash } from "node:crypto";

import {
  createConnectorError,
  type AsyncJobResult,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { z } from "zod";

import { CLUB_FONT_MAX_BYTES, K7_ACTION_SCHEMAS } from "../tools/identity-club-member-team-role/schemas.ts";
import type { JobExecutionContext, JobExecutor } from "./executors.ts";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const TRANSFER_TIMEOUT_MS = 120_000;
const MAX_CLUB_FONTS = 2;

const uploadResponseSchema = z.object({
  font_id: z.string().uuid(),
  family: z.string().min(1).max(64),
  format: z.enum(["woff2", "ttf"]),
  size_bytes: z.number().int().positive().max(CLUB_FONT_MAX_BYTES),
}).passthrough();

const registerEntrySchema = z.object({
  id: z.string().uuid(),
  family: z.string(),
  format: z.enum(["woff2", "ttf"]),
  lizenz: z.string(),
}).passthrough();

const fontResultSchema = z.object({
  font_id: z.string().uuid(),
  club_id: z.string().uuid(),
  family: z.string().min(1).max(64),
  format: z.enum(["woff2", "ttf"]),
  size_bytes: z.number().int().positive().max(CLUB_FONT_MAX_BYTES),
}).strict();

type FontUploadInput = {
  club_id: string;
  source_file_id: string;
  filename: string;
  content_type: "font/ttf" | "font/woff2";
  expected_size: number;
  family: string;
  lizenz: string;
};

type RegisterEntry = { id: string; family: string; format: "woff2" | "ttf"; lizenz: string };

function failure(context: RequestContext, code: "VALIDATION_FAILED" | "TENANT_MISMATCH" | "CONFLICT" | "UPSTREAM_UNAVAILABLE", message: string): Error {
  return createConnectorError({ code, message, request_id: context.request_id, retryable: false });
}

async function timed<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The stored register and the heading/body roles of the club's design. */
function currentDesign(settings: JsonValue): { fonts: RegisterEntry[]; roles: Record<string, Record<string, unknown>> } {
  const design = record(record(settings)?.design_settings);
  const fonts = Array.isArray(design?.fonts)
    ? design.fonts.flatMap((entry) => {
      const parsed = registerEntrySchema.safeParse(entry);
      return parsed.success ? [{ id: parsed.data.id, family: parsed.data.family, format: parsed.data.format, lizenz: parsed.data.lizenz }] : [];
    })
    : [];
  const type = record(record(design?.tokens)?.type);
  const roles: Record<string, Record<string, unknown>> = {};
  for (const role of ["heading", "body"]) {
    const entry = record(type?.[role]);
    if (entry) roles[role] = entry;
  }
  return { fonts, roles };
}

/**
 * cai.club.15.font_upload: moves exactly one clean connector upload (TTF or
 * WOFF2, at most 2 MB) to the content-service font route and registers it in
 * design_settings.fonts (homepage-generator 18 §11). An existing font of the
 * same family is replaced, and roles in tokens.type that pointed at it move to
 * the new font in the same write; a third family is refused before anything
 * is uploaded. The connector file is consumed once; a failure after that
 * point ends the job without a retry. Each side effect starts with a fresh
 * job actor, so a revoked grant stops the job before the next effect.
 *
 * Known limit: the register is a list the club-service replaces on write, so
 * two uploads at the same moment can drop one entry. The job re-reads after
 * its write and fails with CONFLICT instead of reporting success; an atomic
 * registration in the club-service is the structural fix (review K18 R1).
 */
export const CLUB_FONT_UPLOAD_EXECUTOR: JobExecutor = Object.freeze({
  action_id: "cai.club.15.font_upload",
  operation: "execute",
  required_scopes: Object.freeze(["club.read", "admin.write", "files.import", "files.write"] as const),
  fair_use_bucket: "import_export" as const,
  cancellable: false,
  async execute(job: JobExecutionContext): Promise<JsonValue> {
    const context = job.envelope.context;
    const input = K7_ACTION_SCHEMAS["cai.club.15.font_upload"].input.parse(job.envelope.input) as FontUploadInput;
    if (!context.club_id || input.club_id !== context.club_id || job.record.handle.club_id !== context.club_id) {
      throw failure(context, "TENANT_MISMATCH", "Die Schrift gehört nicht zum ausgewählten Verein.");
    }
    const settingsPath = `/clubs/${encodeURIComponent(input.club_id)}/settings`;

    // Capacity first: a third family is refused before the file is consumed or uploaded.
    const before = currentDesign(await (await job.freshActor()).request<JsonValue>({
      method: "GET", service: "club", path: settingsPath, context,
    }));
    if (!before.fonts.some((font) => font.family === input.family) && before.fonts.length >= MAX_CLUB_FONTS) {
      throw failure(context, "CONFLICT", `Der Verein hat schon ${MAX_CLUB_FONTS} Schriften; zuerst eine entfernen oder dieselbe Familie ersetzen.`);
    }

    const source = await job.file_metadata.getFile(input.source_file_id);
    if (!source || !source.upload_id) {
      throw failure(context, "CONFLICT", "Die Quelldatei ist nicht als saubere, unverbrauchte Datei verfügbar.");
    }
    if (source.club_id !== context.club_id) {
      throw failure(context, "TENANT_MISMATCH", "Die Datei gehört nicht zum ausgewählten Verein.");
    }
    if (source.mime_type !== input.content_type || source.size_bytes !== input.expected_size || source.size_bytes > CLUB_FONT_MAX_BYTES) {
      throw failure(context, "VALIDATION_FAILED", "Typ oder Größe der Schriftdatei passen nicht zur Anfrage.");
    }
    if (job.signal?.aborted) throw failure(context, "CONFLICT", "Der Job wurde abgebrochen.");

    await job.freshActor();
    const consumed = await job.files.consumeCleanUpload({
      context,
      club_id: input.club_id,
      upload_id: source.upload_id,
      file_id: input.source_file_id,
    });
    await job.reportProgress(20);

    const download = await job.objects.createPresignedDownload({
      object_key: consumed.object_key,
      expires_in_seconds: DOWNLOAD_URL_TTL_SECONDS,
    });
    const bytes = await timed(job.signal, async (signal) => {
      const response = await job.fetch(download.url, { method: "GET", signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw failure(context, "UPSTREAM_UNAVAILABLE", "Die Schriftdatei konnte nicht gelesen werden.");
      }
      return new Uint8Array(await response.arrayBuffer());
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== consumed.size_bytes || sha256 !== consumed.sha256) {
      throw failure(context, "CONFLICT", "Die Schriftdatei entspricht nicht der geprüften Fassung.");
    }
    await job.reportProgress(40);

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: input.content_type }), input.filename);
    form.append("family", input.family);
    form.append("lizenz", input.lizenz);
    const uploaded = uploadResponseSchema.safeParse(await (await job.freshActor()).request<JsonValue>({
      method: "POST",
      service: "content",
      path: `/fonts/club/${encodeURIComponent(input.club_id)}/upload`,
      context,
      form,
    }));
    if (!uploaded.success) {
      throw failure(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat die Schrift nicht bestätigt.");
    }
    await job.reportProgress(70);

    // Register against the state right before the write: replace the same family, keep the other.
    const now = currentDesign(await (await job.freshActor()).request<JsonValue>({
      method: "GET", service: "club", path: settingsPath, context,
    }));
    const replaced = now.fonts.filter((font) => font.family === input.family).map((font) => font.id);
    const fonts: RegisterEntry[] = [
      ...now.fonts.filter((font) => font.family !== input.family),
      { id: uploaded.data.font_id, family: input.family, format: uploaded.data.format, lizenz: input.lizenz },
    ];
    if (fonts.length > MAX_CLUB_FONTS) {
      throw failure(context, "CONFLICT", `Schrift ${uploaded.data.font_id} ist hochgeladen, aber nicht eingetragen: der Verein hat inzwischen ${MAX_CLUB_FONTS} andere Schriften.`);
    }
    // Roles that pointed at a replaced font move to the new one in the same write
    // (the club-service refuses removing a font that tokens.type still uses). The
    // whole role is sent: validate_tokens checks the patch before it is merged.
    const type: Record<string, JsonValue> = {};
    for (const [role, entry] of Object.entries(now.roles)) {
      if (typeof entry.font_id === "string" && replaced.includes(entry.font_id)) {
        type[role] = {
          family: typeof entry.family === "string" ? entry.family : input.family,
          source: "verein",
          font_id: uploaded.data.font_id,
          ...(typeof entry.weight === "number" ? { weight: entry.weight } : {}),
        };
      }
    }
    // The PUT is its own side effect: a fresh actor right before it.
    await (await job.freshActor()).request<JsonValue>({
      method: "PUT",
      service: "club",
      path: settingsPath,
      context,
      body: {
        design_settings: {
          fonts,
          ...(Object.keys(type).length > 0 ? { tokens: { type } } : {}),
        },
      },
    });
    // The register is a list that a write replaces; a concurrent upload can drop
    // this entry again. Say so instead of reporting success (review K18 R1).
    const after = currentDesign(await (await job.freshActor()).request<JsonValue>({
      method: "GET", service: "club", path: settingsPath, context,
    }));
    if (!after.fonts.some((font) => font.id === uploaded.data.font_id)) {
      throw failure(context, "CONFLICT", `Schrift ${uploaded.data.font_id} ist hochgeladen, aber eine gleichzeitige Änderung hat den Eintrag ersetzt; die Action erneut ausführen.`);
    }
    await job.reportProgress(100);
    return fontResultSchema.parse({
      font_id: uploaded.data.font_id,
      club_id: input.club_id,
      family: input.family,
      format: uploaded.data.format,
      size_bytes: uploaded.data.size_bytes,
    });
  },
  // The job owner learns the font id to use in tokens.type; club and storage stay internal.
  projectResult(output: JsonValue): AsyncJobResult {
    const font = fontResultSchema.parse(output);
    return {
      kind: "club_font",
      font_id: font.font_id,
      family: font.family,
      format: font.format,
      size_bytes: font.size_bytes,
    };
  },
});
