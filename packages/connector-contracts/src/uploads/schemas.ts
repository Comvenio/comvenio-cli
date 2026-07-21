import { z } from "zod";

import { CONNECTOR_UPLOAD_MIME_VALUES } from "./types.ts";

export const MAX_CONNECTOR_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const UPLOAD_HANDLE_TTL_SECONDS = 15 * 60;
export const RESULT_FILE_TTL_SECONDS = 24 * 60 * 60;
export const MAX_ZIP_ENTRIES = 1_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = MAX_CONNECTOR_FILE_SIZE_BYTES;
export const MAX_ZIP_COMPRESSION_RATIO = 100;
export const MAX_ZIP_DIRECTORY_DEPTH = 3;
export const MAX_ZIP_PATH_LENGTH = 240;

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const uploadMime = z.enum(CONNECTOR_UPLOAD_MIME_VALUES);
const safeFileName = z.string().trim().min(1).max(240)
  .refine((value) => !/[\\/\0]/u.test(value) && value !== "." && value !== "..", {
    message: "Der Dateiname muss ein einzelner sicherer Basisname sein.",
  });

export const CONNECTOR_UPLOAD_MIME_SCHEMA = uploadMime;
export const UPLOAD_STATE_SCHEMA = z.enum([
  "pending",
  "uploaded",
  "scanning",
  "clean",
  "rejected",
  "consumed",
  "expired",
]);
export const UPLOAD_REJECTION_CODE_SCHEMA = z.enum([
  "MIME_MISMATCH",
  "SIZE_MISMATCH",
  "HASH_MISMATCH",
  "MALWARE",
  "ARCHIVE_LIMIT_EXCEEDED",
  "UNSAFE_ARCHIVE",
  "EXPIRED",
]);

export const CONNECTOR_FILE_REFERENCE_SCHEMA = z.object({
  file_id: uuid,
  club_id: uuid,
  name: safeFileName,
  mime_type: uploadMime,
  size_bytes: z.number().int().positive().max(MAX_CONNECTOR_FILE_SIZE_BYTES),
  sha256,
  download_url: z.string().url().refine((value) => new URL(value).protocol === "https:", {
    message: "Dateireferenzen benötigen eine HTTPS-URL.",
  }),
  expires_at: instant,
}).strict();

export const UPLOAD_CREATE_REQUEST_SCHEMA = z.object({
  club_id: uuid,
  filename: safeFileName,
  mime_type: uploadMime,
  size_bytes: z.number().int().positive().max(MAX_CONNECTOR_FILE_SIZE_BYTES),
  purpose: z.enum(["domain_import", "event_asset", "news_asset", "club_file"]),
}).strict();

export const UPLOAD_HANDLE_SCHEMA = z.object({
  upload_id: uuid,
  club_id: uuid,
  owner_subject_id: uuid,
  upload_url: z.string().url().refine((value) => new URL(value).protocol === "https:").nullable(),
  required_headers: z.object({ "Content-Type": uploadMime }).strict().nullable(),
  state: UPLOAD_STATE_SCHEMA,
  expires_at: instant,
  file_id: uuid.nullable(),
  rejection_code: UPLOAD_REJECTION_CODE_SCHEMA.nullable(),
}).strict().superRefine((handle, context) => {
  const pending = handle.state === "pending";
  if (pending !== (handle.upload_url !== null && handle.required_headers !== null)) {
    context.addIssue({ code: "custom", message: "Nur ein pending Upload darf eine Upload-URL enthalten." });
  }
  if ((handle.state === "clean" || handle.state === "consumed") !== (handle.file_id !== null)) {
    context.addIssue({ code: "custom", message: "Clean/Consumed benötigt genau eine File-ID." });
  }
  if ((handle.state === "rejected" || handle.state === "expired") !== (handle.rejection_code !== null)) {
    context.addIssue({ code: "custom", message: "Rejected/Expired benötigt genau einen sicheren Ablehnungscode." });
  }
});

export const UPLOAD_COMPLETE_REQUEST_SCHEMA = z.object({
  size_bytes: z.number().int().positive().max(MAX_CONNECTOR_FILE_SIZE_BYTES),
  sha256,
}).strict();

export const FILE_UPLOAD_COMPLETE_INPUT_SCHEMA = z.object({
  club_id: uuid,
  upload_id: uuid,
  completion: UPLOAD_COMPLETE_REQUEST_SCHEMA,
}).strict();

export const FILE_GET_INPUT_SCHEMA = z.object({ club_id: uuid, file_id: uuid }).strict();
