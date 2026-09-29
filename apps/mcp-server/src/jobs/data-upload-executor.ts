import { createHash } from "node:crypto";

import {
  createConnectorError,
  type AsyncJobResult,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { z } from "zod";

import { K12_ACTION_SCHEMAS } from "../tools/content-homepage-news-data/schemas.ts";
import type { JobExecutionContext, JobExecutor } from "./executors.ts";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const TRANSFER_TIMEOUT_MS = 120_000;

const presignResponseSchema = z.object({
  file_id: z.string().uuid(),
  upload_url: z.string().url().refine((value) => value.startsWith("https://")),
  headers: z.record(z.string(), z.unknown()),
}).passthrough();

const finalizeResponseSchema = z.object({
  ok: z.literal(true),
  size_bytes: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

const uploadResultSchema = z.object({
  file_id: z.string().uuid(),
  club_id: z.string().uuid(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number().int().positive(),
  visibility: z.enum(["private", "public"]),
  context_type: z.string(),
  context_id: z.string().uuid().nullable(),
}).strict();

type UploadInput = {
  club_id: string;
  department_id?: string | null;
  source_file_id: string;
  filename: string;
  content_type: string;
  expected_size: number;
  context_type: string;
  context_id?: string;
  sub_context_id?: string;
  context_label?: string;
  visibility: "private" | "public";
};

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

function stringHeaders(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string" && !/[\r\n]/u.test(entry[1])));
}

/**
 * cai.data.06.upload: moves exactly one clean connector upload into the
 * content-service (presign-upload -> PUT -> finalize) on behalf of the user.
 * The connector file is consumed once before the transfer; a failure after
 * that point ends the job without a retry, because the file cannot be
 * consumed a second time. Immediately before each side effect (consumption,
 * presign-upload, PUT, finalize) a fresh job actor is obtained, so a revoked
 * grant stops the job before the next effect.
 */
export const DATA_UPLOAD_EXECUTOR: JobExecutor = Object.freeze({
  action_id: "cai.data.06.upload",
  operation: "upload",
  required_scopes: Object.freeze(["files.import", "files.write"] as const),
  fair_use_bucket: "import_export" as const,
  cancellable: false,
  async execute(job: JobExecutionContext): Promise<JsonValue> {
    const context = job.envelope.context;
    const input = K12_ACTION_SCHEMAS["cai.data.06.upload"].input.parse(job.envelope.input) as UploadInput;
    if (!context.club_id || input.club_id !== context.club_id || job.record.handle.club_id !== context.club_id) {
      throw failure(context, "TENANT_MISMATCH", "Die Datei gehört nicht zum ausgewählten Verein.");
    }

    // Pre-check before the one-time consumption: the declared type and size must match the clean file.
    const source = await job.file_metadata.getFile(input.source_file_id);
    if (!source || !source.upload_id) {
      throw failure(context, "CONFLICT", "Die Quelldatei ist nicht als saubere, unverbrauchte Datei verfügbar.");
    }
    if (source.club_id !== context.club_id) {
      throw failure(context, "TENANT_MISMATCH", "Die Datei gehört nicht zum ausgewählten Verein.");
    }
    if (source.mime_type !== input.content_type || source.size_bytes !== input.expected_size) {
      throw failure(context, "VALIDATION_FAILED", "Typ oder Größe der Quelldatei passen nicht zur Anfrage.");
    }
    if (job.signal?.aborted) throw failure(context, "CONFLICT", "Der Job wurde abgebrochen.");

    // The file authorization of the consumption resolves a fresh snapshot with this actor.
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
        throw failure(context, "UPSTREAM_UNAVAILABLE", "Die Quelldatei konnte nicht gelesen werden.");
      }
      return new Uint8Array(await response.arrayBuffer());
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== consumed.size_bytes || sha256 !== consumed.sha256) {
      throw failure(context, "CONFLICT", "Die Quelldatei entspricht nicht der geprüften Fassung.");
    }
    await job.reportProgress(40);

    const presignClient = await job.freshActor();
    const presigned = presignResponseSchema.safeParse(await presignClient.request<JsonValue>({
      method: "POST",
      service: "content",
      path: "/files/presign-upload",
      context,
      body: {
        club_id: input.club_id,
        ...(context.department_id ? { club_department_id: context.department_id } : {}),
        filename: input.filename,
        content_type: input.content_type,
        visibility: input.visibility,
        context_type: input.context_type,
        ...(input.context_id ? { context_id: input.context_id } : {}),
        ...(input.sub_context_id ? { sub_context_id: input.sub_context_id } : {}),
        expected_size: input.expected_size,
        ...(input.context_label ? { context_label: input.context_label } : {}),
      },
    }));
    if (!presigned.success) {
      throw failure(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat keinen gültigen Upload vorbereitet.");
    }
    // The PUT itself is not bound to the grant: check it once more right before the transfer.
    await job.freshActor();
    await timed(job.signal, async (signal) => {
      const response = await job.fetch(presigned.data.upload_url, {
        method: "PUT",
        headers: { ...stringHeaders(presigned.data.headers), "Content-Type": input.content_type },
        body: bytes,
        signal,
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) {
        throw failure(context, "UPSTREAM_UNAVAILABLE", "Die Datei konnte nicht an den Fachservice übertragen werden.");
      }
    });
    await job.reportProgress(80);

    const finalizeClient = await job.freshActor();
    const finalized = finalizeResponseSchema.safeParse(await finalizeClient.request<JsonValue>({
      method: "POST",
      service: "content",
      path: `/files/${encodeURIComponent(presigned.data.file_id)}/finalize`,
      context,
    }));
    if (!finalized.success) {
      throw failure(context, "UPSTREAM_UNAVAILABLE", "Der Fachservice hat den Upload nicht bestätigt.");
    }
    await job.reportProgress(100);
    return uploadResultSchema.parse({
      file_id: presigned.data.file_id,
      club_id: input.club_id,
      filename: input.filename,
      content_type: input.content_type,
      size_bytes: finalized.data.size_bytes ?? bytes.byteLength,
      visibility: input.visibility,
      context_type: input.context_type,
      context_id: input.context_id ?? null,
    });
  },
  // Only the DataShare file facts reach the job owner; club, visibility and context stay internal.
  projectResult(output: JsonValue): AsyncJobResult {
    const uploaded = uploadResultSchema.parse(output);
    return {
      kind: "datashare_file",
      file_id: uploaded.file_id,
      filename: uploaded.filename,
      content_type: uploaded.content_type,
      size_bytes: uploaded.size_bytes,
    };
  },
});
