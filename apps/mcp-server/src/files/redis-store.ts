import type IORedis from "ioredis";

import type { UUID } from "@comvenio/connector-contracts";

import type {
  FileMetadataStore,
  InternalConnectorFileRecord,
  InternalUploadRecord,
} from "./types.ts";

const FILE_TTL_SECONDS = 24 * 60 * 60;
const REJECTED_UPLOAD_TTL_SECONDS = 24 * 60 * 60;

const CONSUME_FILE_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return nil end
local record = cjson.decode(encoded)
if record.upload_id ~= ARGV[1]
  or record.owner_subject_id ~= ARGV[2]
  or record.oauth_grant_id ~= ARGV[3]
  or record.club_id ~= ARGV[4]
  or record.state ~= 'clean'
  or record.expires_at <= ARGV[5] then
  return nil
end
record.state = 'consumed'
record.consumed_at = ARGV[5]
local updated = cjson.encode(record)
redis.call('SET', KEYS[1], updated, 'KEEPTTL')
return updated
`;

const FINALIZE_UPLOAD_LUA = `
if redis.call('EXISTS', KEYS[1]) ~= 1 then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'XX')
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4], 'NX')
return 1
`;

function secondsUntil(instant: string, minimum = 1): number {
  return Math.max(minimum, Math.ceil((Date.parse(instant) - Date.now()) / 1_000));
}

function parseRecord<T>(value: string | null, label: string): T | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as T;
  } catch {
    throw new Error(`${label} sind beschädigt.`);
  }
}

export class RedisFileMetadataStore implements FileMetadataStore {
  constructor(private readonly redis: IORedis, private readonly prefix = "comvenio:mcp") {}

  async createUpload(record: InternalUploadRecord): Promise<void> {
    const result = await this.redis.set(
      this.#uploadKey(record.handle.upload_id),
      JSON.stringify(record),
      "EX",
      secondsUntil(record.handle.expires_at),
      "NX",
    );
    if (result !== "OK") throw new Error("Der Upload existiert bereits.");
  }

  async getUpload(uploadId: UUID): Promise<InternalUploadRecord | null> {
    return parseRecord(await this.redis.get(this.#uploadKey(uploadId)), "Die gespeicherten Uploadmetadaten");
  }

  async updateUpload(record: InternalUploadRecord): Promise<void> {
    const key = this.#uploadKey(record.handle.upload_id);
    const ttl = ["rejected", "expired", "clean", "consumed"].includes(record.handle.state)
      ? REJECTED_UPLOAD_TTL_SECONDS
      : secondsUntil(record.handle.expires_at);
    const result = await this.redis.set(key, JSON.stringify(record), "EX", ttl, "XX");
    if (result !== "OK") throw new Error("Der Upload existiert nicht.");
  }

  async createFile(record: InternalConnectorFileRecord): Promise<void> {
    const result = await this.redis.set(
      this.#fileKey(record.file_id),
      JSON.stringify(record),
      "EX",
      Math.min(FILE_TTL_SECONDS, secondsUntil(record.expires_at)),
      "NX",
    );
    if (result !== "OK") throw new Error("Die Datei existiert bereits.");
  }

  async finalizeUpload(input: {
    upload: InternalUploadRecord;
    file: InternalConnectorFileRecord;
  }): Promise<void> {
    const result = await this.redis.eval(
      FINALIZE_UPLOAD_LUA,
      2,
      this.#uploadKey(input.upload.handle.upload_id),
      this.#fileKey(input.file.file_id),
      JSON.stringify(input.upload),
      REJECTED_UPLOAD_TTL_SECONDS,
      JSON.stringify(input.file),
      Math.min(FILE_TTL_SECONDS, secondsUntil(input.file.expires_at)),
    );
    if (result === 0) throw new Error("Der Upload existiert nicht.");
    if (result !== 1) throw new Error("Die Datei existiert bereits.");
  }

  async getFile(fileId: UUID): Promise<InternalConnectorFileRecord | null> {
    return parseRecord(await this.redis.get(this.#fileKey(fileId)), "Die gespeicherten Dateimetadaten");
  }

  async consumeFile(input: {
    file_id: UUID;
    upload_id: UUID;
    subject_id: UUID;
    oauth_grant_id: UUID;
    club_id: UUID;
    now: string;
  }): Promise<InternalConnectorFileRecord | null> {
    const result = await this.redis.eval(
      CONSUME_FILE_LUA,
      1,
      this.#fileKey(input.file_id),
      input.upload_id,
      input.subject_id,
      input.oauth_grant_id,
      input.club_id,
      input.now,
    );
    return parseRecord(typeof result === "string" ? result : null, "Die verbrauchten Dateimetadaten");
  }

  #uploadKey(uploadId: UUID): string { return `${this.prefix}:upload:${uploadId}`; }
  #fileKey(fileId: UUID): string { return `${this.prefix}:file:${fileId}`; }
}
