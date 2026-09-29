import type IORedis from "ioredis";

import type { UUID } from "@comvenio/connector-contracts";

import type {
  FileMetadataStore,
  InternalConnectorFileRecord,
  InternalUploadRecord,
  UploadCompletionGuard,
} from "./types.ts";

const FILE_TTL_SECONDS = 24 * 60 * 60;
const REJECTED_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
/** A running completion keeps its record past expires_at, so it can still finish or reject. */
const SCANNING_UPLOAD_TTL_SECONDS = 15 * 60;

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

// Shared guard: the upload must still be in state ARGV[1] and held by completion ARGV[2]
// ('' = none). A missing or JSON-null completion_id counts as none.
const UPLOAD_GUARD_LUA = `
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local record = cjson.decode(encoded)
local owner = record.completion_id
if owner == nil or owner == cjson.null then owner = '' end
if record.handle.state ~= ARGV[1] or owner ~= ARGV[2] then return -2 end
`;

const COMPARE_AND_SET_UPLOAD_LUA = `${UPLOAD_GUARD_LUA}
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4], 'XX')
return 1
`;

const FINALIZE_UPLOAD_LUA = `${UPLOAD_GUARD_LUA}
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4], 'XX')
redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[6], 'NX')
return 1
`;

const TERMINAL_UPLOAD_STATES = ["rejected", "expired", "clean", "consumed"];

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
    const result = await this.redis.set(key, JSON.stringify(record), "EX", this.#uploadTtl(record), "XX");
    if (result !== "OK") throw new Error("Der Upload existiert nicht.");
  }

  async compareAndSetUpload(input: {
    expected: UploadCompletionGuard;
    record: InternalUploadRecord;
  }): Promise<boolean> {
    const result = await this.redis.eval(
      COMPARE_AND_SET_UPLOAD_LUA,
      1,
      this.#uploadKey(input.record.handle.upload_id),
      input.expected.state,
      input.expected.completion_id ?? "",
      JSON.stringify(input.record),
      this.#uploadTtl(input.record),
    );
    return result === 1;
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
    expected: UploadCompletionGuard;
    upload: InternalUploadRecord;
    file: InternalConnectorFileRecord;
  }): Promise<boolean> {
    const result = await this.redis.eval(
      FINALIZE_UPLOAD_LUA,
      2,
      this.#uploadKey(input.upload.handle.upload_id),
      this.#fileKey(input.file.file_id),
      input.expected.state,
      input.expected.completion_id ?? "",
      JSON.stringify(input.upload),
      REJECTED_UPLOAD_TTL_SECONDS,
      JSON.stringify(input.file),
      Math.min(FILE_TTL_SECONDS, secondsUntil(input.file.expires_at)),
    );
    if (result === 0) throw new Error("Der Upload existiert nicht.");
    if (result === -2) return false;
    if (result !== 1) throw new Error("Die Datei existiert bereits.");
    return true;
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

  /** Terminal records outlive the upload URL, so a rejected upload stays closed until the URL expired. */
  #uploadTtl(record: InternalUploadRecord): number {
    if (TERMINAL_UPLOAD_STATES.includes(record.handle.state)) return REJECTED_UPLOAD_TTL_SECONDS;
    if (record.handle.state === "scanning") return Math.max(SCANNING_UPLOAD_TTL_SECONDS, secondsUntil(record.handle.expires_at));
    return secondsUntil(record.handle.expires_at);
  }

  #uploadKey(uploadId: UUID): string { return `${this.prefix}:upload:${uploadId}`; }
  #fileKey(fileId: UUID): string { return `${this.prefix}:file:${fileId}`; }
}
