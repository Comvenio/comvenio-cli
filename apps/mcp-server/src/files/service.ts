import { randomUUID } from "node:crypto";

import {
  CONNECTOR_FILE_REFERENCE_SCHEMA,
  FILE_GET_INPUT_SCHEMA,
  FILE_UPLOAD_COMPLETE_INPUT_SCHEMA,
  RESULT_FILE_TTL_SECONDS,
  UPLOAD_CREATE_REQUEST_SCHEMA,
  UPLOAD_HANDLE_SCHEMA,
  UPLOAD_HANDLE_TTL_SECONDS,
  createConnectorError,
  normalizeRequestContext,
  type ConnectorFileReference,
  type RequestContext,
  type UploadCreateRequest,
  type UploadHandle,
  type UploadRejectionCode,
  type UUID,
} from "@comvenio/connector-contracts";

import type {
  FileAuthorizationPort,
  FileClock,
  FileConsumeInput,
  FileGetInput,
  FileMetadataStore,
  FileRandom,
  FileUploadCompleteInput,
  InternalConnectorFileRecord,
  InternalUploadRecord,
  MalwareScannerPort,
  QuarantineObjectPort,
} from "./types.ts";
import { validateStoredObject } from "./validation.ts";

const SYSTEM_CLOCK: FileClock = { now: () => new Date() };
const SYSTEM_RANDOM: FileRandom = { uuid: () => randomUUID() };
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

function after(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function bound(contextInput: RequestContext, clubId: UUID): {
  context: RequestContext;
  subject_id: UUID;
  oauth_grant_id: UUID;
  club_id: UUID;
} {
  const context = normalizeRequestContext(contextInput);
  if (!context.subject_id || !context.oauth_grant_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für Dateiaktionen ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (!context.club_id) {
    throw createConnectorError({ code: "CLUB_SELECTION_REQUIRED", message: "Für Dateiaktionen muss genau ein Verein gewählt sein.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== clubId) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Die Datei gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  return { context, subject_id: context.subject_id, oauth_grant_id: context.oauth_grant_id, club_id: context.club_id };
}

function safeObjectKey(clubId: UUID, uploadId: UUID): string {
  return `mcp-quarantine/${clubId}/${uploadId}`;
}

function assertActiveMetadata(record: InternalUploadRecord): asserts record is InternalUploadRecord & {
  filename: string;
  mime_type: NonNullable<InternalUploadRecord["mime_type"]>;
  size_bytes: number;
  purpose: NonNullable<InternalUploadRecord["purpose"]>;
  object_key: string;
} {
  if (!record.filename || !record.mime_type || record.size_bytes === null || !record.purpose || !record.object_key) {
    throw new Error("Aktive Uploadmetadaten sind unvollständig.");
  }
}

export class ConnectorFileService {
  constructor(
    private readonly metadata: FileMetadataStore,
    private readonly objects: QuarantineObjectPort,
    private readonly scanner: MalwareScannerPort,
    private readonly authorization: FileAuthorizationPort,
    private readonly clock: FileClock = SYSTEM_CLOCK,
    private readonly random: FileRandom = SYSTEM_RANDOM,
  ) {}

  async startUpload(input: { context: RequestContext; request: UploadCreateRequest }): Promise<UploadHandle> {
    const request = UPLOAD_CREATE_REQUEST_SCHEMA.parse(input.request);
    const binding = bound(input.context, request.club_id);
    if (!binding.context.scopes.includes("files.write")) {
      throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für Uploads fehlt der Scope files.write.", request_id: binding.context.request_id, retryable: false, required_scope: "files.write" });
    }
    const authorized = await this.authorization.reauthorize({ context: binding.context, action: "upload_start", purpose: request.purpose });
    const now = this.clock.now();
    const uploadId = this.random.uuid();
    const objectKey = safeObjectKey(binding.club_id, uploadId);
    const presigned = await this.objects.createPresignedUpload({
      object_key: objectKey,
      mime_type: request.mime_type,
      size_bytes: request.size_bytes,
      expires_in_seconds: UPLOAD_HANDLE_TTL_SECONDS,
    });
    const handle = UPLOAD_HANDLE_SCHEMA.parse({
      upload_id: uploadId,
      club_id: binding.club_id,
      owner_subject_id: binding.subject_id,
      upload_url: presigned.url,
      required_headers: { "Content-Type": request.mime_type },
      state: "pending",
      expires_at: after(now, UPLOAD_HANDLE_TTL_SECONDS),
      file_id: null,
      rejection_code: null,
    });
    await this.metadata.createUpload({
      handle,
      oauth_grant_id: binding.oauth_grant_id,
      owner_subject_id: binding.subject_id,
      capability_version: authorized.capability_version,
      filename: request.filename,
      mime_type: request.mime_type,
      size_bytes: request.size_bytes,
      purpose: request.purpose,
      object_key: objectKey,
      staged_file_id: null,
      rejection_sha256: null,
      created_at: now.toISOString(),
    });
    return handle;
  }

  async completeUpload(input: FileUploadCompleteInput): Promise<UploadHandle> {
    const parsed = FILE_UPLOAD_COMPLETE_INPUT_SCHEMA.parse({
      club_id: input.club_id,
      upload_id: input.upload_id,
      completion: input.completion,
    });
    const binding = bound(input.context, parsed.club_id);
    if (!binding.context.scopes.includes("files.write")) {
      throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für Uploads fehlt der Scope files.write.", request_id: binding.context.request_id, retryable: false, required_scope: "files.write" });
    }
    const record = await this.#ownedUpload(parsed.upload_id, binding);
    if (record.handle.state === "rejected" || record.handle.state === "expired") {
      throw createConnectorError({ code: "CONFLICT", message: "Der Upload kann in seinem aktuellen Zustand nicht abgeschlossen werden.", request_id: binding.context.request_id, retryable: false });
    }
    assertActiveMetadata(record);
    const authorized = await this.authorization.reauthorize({ context: binding.context, action: "upload_complete", purpose: record.purpose });
    if (record.handle.state === "clean" || record.handle.state === "consumed") return UPLOAD_HANDLE_SCHEMA.parse(record.handle);
    if (Date.parse(record.handle.expires_at) <= this.clock.now().getTime()) {
      return this.#reject(record, "EXPIRED");
    }
    if (authorized.capability_version !== record.capability_version) {
      throw createConnectorError({ code: "PERMISSION_DENIED", message: "Die Dateiberechtigung hat sich seit dem Uploadstart geändert.", request_id: binding.context.request_id, retryable: false });
    }

    const inspection = await this.objects.inspect({
      object_key: record.object_key,
      declared_filename: record.filename,
      declared_mime_type: record.mime_type,
    });
    const rejection = validateStoredObject({
      inspection,
      declared_mime_type: record.mime_type,
      declared_size_bytes: record.size_bytes,
      completion_size_bytes: parsed.completion.size_bytes,
      completion_sha256: parsed.completion.sha256,
    });
    if (rejection) return this.#reject(record, rejection, inspection.sha256);

    record.handle = UPLOAD_HANDLE_SCHEMA.parse({
      ...record.handle,
      upload_url: null,
      required_headers: null,
      state: "scanning",
    });
    record.staged_file_id ??= this.random.uuid();
    await this.metadata.updateUpload(record);
    const scan = await this.scanner.scan({ object_key: record.object_key });
    if (scan === "unavailable") {
      throw createConnectorError({ code: "UPSTREAM_UNAVAILABLE", message: "Die Sicherheitsprüfung ist vorübergehend nicht verfügbar.", request_id: binding.context.request_id, retryable: true, retry_after_seconds: 15 });
    }
    if (scan === "infected") return this.#reject(record, "MALWARE", inspection.sha256);

    const fileId = record.staged_file_id;
    const promoted = await this.objects.promoteClean({ quarantine_object_key: record.object_key, file_id: fileId });
    const now = this.clock.now();
    const file: InternalConnectorFileRecord = {
      file_id: fileId,
      upload_id: record.handle.upload_id,
      oauth_grant_id: binding.oauth_grant_id,
      owner_subject_id: binding.subject_id,
      club_id: binding.club_id,
      capability_version: authorized.capability_version,
      name: record.filename,
      mime_type: record.mime_type,
      size_bytes: inspection.size_bytes,
      sha256: inspection.sha256,
      purpose: record.purpose,
      object_key: promoted.object_key,
      state: "clean",
      created_at: now.toISOString(),
      expires_at: after(now, RESULT_FILE_TTL_SECONDS),
      consumed_at: null,
    };
    record.handle = UPLOAD_HANDLE_SCHEMA.parse({
      ...record.handle,
      state: "clean",
      file_id: fileId,
      rejection_code: null,
    });
    await this.metadata.finalizeUpload({ upload: record, file });
    return record.handle;
  }

  async getFile(input: FileGetInput): Promise<ConnectorFileReference> {
    const parsed = FILE_GET_INPUT_SCHEMA.parse({ club_id: input.club_id, file_id: input.file_id });
    const binding = bound(input.context, parsed.club_id);
    if (!binding.context.scopes.includes("files.import") && !binding.context.scopes.includes("files.export")) {
      throw createConnectorError({ code: "SCOPE_REQUIRED", message: "Für Dateireferenzen fehlt ein Datei-Scope.", request_id: binding.context.request_id, retryable: false, required_scope: "files.export" });
    }
    const file = await this.#ownedFile(parsed.file_id, binding);
    await this.authorization.reauthorize({ context: binding.context, action: "file_get", purpose: file.purpose });
    if (file.state === "expired" || Date.parse(file.expires_at) <= this.clock.now().getTime()) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Die Dateireferenz ist abgelaufen oder nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    const download = await this.objects.createPresignedDownload({ object_key: file.object_key, expires_in_seconds: DOWNLOAD_URL_TTL_SECONDS });
    return CONNECTOR_FILE_REFERENCE_SCHEMA.parse({
      file_id: file.file_id,
      club_id: file.club_id,
      name: file.name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
      download_url: download.url,
      expires_at: download.expires_at,
    });
  }

  async consumeCleanUpload(input: FileConsumeInput): Promise<InternalConnectorFileRecord> {
    const binding = bound(input.context, input.club_id);
    const upload = await this.#ownedUpload(input.upload_id, binding);
    assertActiveMetadata(upload);
    if (upload.handle.file_id !== input.file_id || upload.handle.state !== "clean") {
      throw createConnectorError({ code: "CONFLICT", message: "Der Upload ist nicht als saubere, unverbrauchte Datei verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    await this.authorization.reauthorize({ context: binding.context, action: "file_consume", purpose: upload.purpose });
    const consumed = await this.metadata.consumeFile({
      file_id: input.file_id,
      upload_id: input.upload_id,
      subject_id: binding.subject_id,
      oauth_grant_id: binding.oauth_grant_id,
      club_id: binding.club_id,
      now: this.clock.now().toISOString(),
    });
    if (!consumed) {
      throw createConnectorError({ code: "CONFLICT", message: "Die Datei wurde bereits verbraucht oder ist abgelaufen.", request_id: binding.context.request_id, retryable: false });
    }
    upload.handle = UPLOAD_HANDLE_SCHEMA.parse({ ...upload.handle, state: "consumed" });
    await this.metadata.updateUpload(upload);
    return consumed;
  }

  async #reject(record: InternalUploadRecord, rejectionCode: UploadRejectionCode, rejectionSha256: string | null = null): Promise<UploadHandle> {
    const objectKey = record.object_key;
    record.handle = UPLOAD_HANDLE_SCHEMA.parse({
      ...record.handle,
      upload_url: null,
      required_headers: null,
      state: rejectionCode === "EXPIRED" ? "expired" : "rejected",
      rejection_code: rejectionCode,
    });
    if (objectKey) await this.objects.delete({ object_key: objectKey });
    record.filename = null;
    record.mime_type = null;
    record.size_bytes = null;
    record.purpose = null;
    record.object_key = null;
    record.staged_file_id = null;
    record.rejection_sha256 = rejectionSha256;
    await this.metadata.updateUpload(record);
    return record.handle;
  }

  async #ownedUpload(uploadId: UUID, binding: ReturnType<typeof bound>): Promise<InternalUploadRecord> {
    const record = await this.metadata.getUpload(uploadId);
    if (!record
      || record.owner_subject_id !== binding.subject_id
      || record.oauth_grant_id !== binding.oauth_grant_id
      || record.handle.club_id !== binding.club_id) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Der Upload ist im aktuellen Vereinskontext nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    return record;
  }

  async #ownedFile(fileId: UUID, binding: ReturnType<typeof bound>): Promise<InternalConnectorFileRecord> {
    const record = await this.metadata.getFile(fileId);
    if (!record
      || record.owner_subject_id !== binding.subject_id
      || record.oauth_grant_id !== binding.oauth_grant_id
      || record.club_id !== binding.club_id) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Die Datei ist im aktuellen Vereinskontext nicht verfügbar.", request_id: binding.context.request_id, retryable: false });
    }
    return record;
  }
}
