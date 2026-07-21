import type { UUID } from "@comvenio/connector-contracts";

import type {
  FileMetadataStore,
  InternalConnectorFileRecord,
  InternalUploadRecord,
} from "./types.ts";

export class MemoryFileMetadataStore implements FileMetadataStore {
  readonly #uploads = new Map<UUID, InternalUploadRecord>();
  readonly #files = new Map<UUID, InternalConnectorFileRecord>();

  async createUpload(record: InternalUploadRecord): Promise<void> {
    if (this.#uploads.has(record.handle.upload_id)) throw new Error("Der Upload existiert bereits.");
    this.#uploads.set(record.handle.upload_id, structuredClone(record));
  }

  async getUpload(uploadId: UUID): Promise<InternalUploadRecord | null> {
    const record = this.#uploads.get(uploadId);
    return record ? structuredClone(record) : null;
  }

  async updateUpload(record: InternalUploadRecord): Promise<void> {
    if (!this.#uploads.has(record.handle.upload_id)) throw new Error("Der Upload existiert nicht.");
    this.#uploads.set(record.handle.upload_id, structuredClone(record));
  }

  async createFile(record: InternalConnectorFileRecord): Promise<void> {
    if (this.#files.has(record.file_id)) throw new Error("Die Datei existiert bereits.");
    this.#files.set(record.file_id, structuredClone(record));
  }

  async finalizeUpload(input: {
    upload: InternalUploadRecord;
    file: InternalConnectorFileRecord;
  }): Promise<void> {
    if (!this.#uploads.has(input.upload.handle.upload_id)) throw new Error("Der Upload existiert nicht.");
    if (this.#files.has(input.file.file_id)) throw new Error("Die Datei existiert bereits.");
    this.#files.set(input.file.file_id, structuredClone(input.file));
    this.#uploads.set(input.upload.handle.upload_id, structuredClone(input.upload));
  }

  async getFile(fileId: UUID): Promise<InternalConnectorFileRecord | null> {
    const record = this.#files.get(fileId);
    return record ? structuredClone(record) : null;
  }

  async consumeFile(input: {
    file_id: UUID;
    upload_id: UUID;
    subject_id: UUID;
    oauth_grant_id: UUID;
    club_id: UUID;
    now: string;
  }): Promise<InternalConnectorFileRecord | null> {
    const record = this.#files.get(input.file_id);
    if (!record
      || record.upload_id !== input.upload_id
      || record.owner_subject_id !== input.subject_id
      || record.oauth_grant_id !== input.oauth_grant_id
      || record.club_id !== input.club_id
      || record.state !== "clean"
      || Date.parse(record.expires_at) <= Date.parse(input.now)) return null;
    record.state = "consumed";
    record.consumed_at = input.now;
    return structuredClone(record);
  }
}
