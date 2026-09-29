import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_CONNECTOR_FILE_SIZE_BYTES,
  UPLOAD_HANDLE_TTL_SECONDS,
  type ConnectorUploadMime,
  type UploadRequiredHeaders,
  type UUID,
} from "@comvenio/connector-contracts";

import { inspectStoredObject, UNINSPECTED_SHA256, type InspectableObject } from "./object-inspection.ts";
import { encodeS3Path, presignSigV4 } from "./sigv4-presign.ts";
import type { FileClock, ObjectInspectionResult, QuarantineObjectPort } from "./types.ts";

export interface S3QuarantineConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Prefix for promoted clean objects; must differ from the quarantine prefix. */
  cleanPrefix?: string;
}

/** Minimal storage surface the store needs; Bun.S3Client in production, in-memory in tests. */
export interface QuarantineObjectBackend {
  size(objectKey: string): Promise<number>;
  stream(objectKey: string): ReadableStream<Uint8Array>;
  write(objectKey: string, source: AsyncIterable<Uint8Array>, options: { content_type: string; content_disposition: string }): Promise<void>;
  delete(objectKey: string): Promise<void>;
  /** Presigned GET (downloads of promoted clean objects). */
  presignGet(objectKey: string, options: { expires_in_seconds: number }): string;
  /** Presigned PUT whose signature covers exactly these request headers (SigV4 signed headers). */
  presignPut(objectKey: string, options: { expires_in_seconds: number; signed_headers: Readonly<Record<string, string>> }): string;
}

const QUARANTINE_PREFIX = "mcp-quarantine";
const DEFAULT_CLEAN_PREFIX = "mcp-clean";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const QUARANTINE_KEY = new RegExp(`^${QUARANTINE_PREFIX}/(${UUID_PATTERN})/(${UUID_PATTERN})$`, "iu");
const UUID_ONLY = new RegExp(`^${UUID_PATTERN}$`, "iu");
export const MAX_PINNED_INSPECTIONS = 10_000;
/** Prefix of the private per-inspection directories below os.tmpdir(). */
export const LOCAL_COPY_PREFIX = "comvenio-mcp-inspect-";
const LOCAL_READ_CHUNK_BYTES = 64 * 1024;
const SYSTEM_CLOCK: FileClock = { now: () => new Date() };

export function createBunS3Backend(config: S3QuarantineConfig, clock: FileClock = SYSTEM_CLOCK): QuarantineObjectBackend {
  const client = new Bun.S3Client({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  // Path-style object URL, as Bun.S3Client addresses the bucket with a custom endpoint.
  const endpoint = new URL(config.endpoint);
  const base = `${endpoint.origin}${endpoint.pathname.replace(/\/+$/u, "")}`;
  return {
    async size(objectKey) {
      return (await client.file(objectKey).stat()).size;
    },
    stream(objectKey) {
      return client.file(objectKey).stream();
    },
    async write(objectKey, source, options) {
      const writer = client.file(objectKey).writer({ type: options.content_type, contentDisposition: options.content_disposition });
      try {
        for await (const chunk of source) await writer.write(chunk);
      } catch (error) {
        await writer.end(error instanceof Error ? error : new Error("Copy aborted."));
        throw error;
      }
      await writer.end();
    },
    async delete(objectKey) {
      await client.file(objectKey).delete();
    },
    presignGet(objectKey, options) {
      return client.file(objectKey).presign({ method: "GET", expiresIn: options.expires_in_seconds });
    },
    presignPut(objectKey, options) {
      // Bun's presign cannot sign content-length, so the PUT is signed here (SigV4, UNSIGNED-PAYLOAD).
      return presignSigV4({
        method: "PUT",
        url: `${base}${encodeS3Path([config.bucket, objectKey])}`,
        region: config.region,
        access_key_id: config.accessKeyId,
        secret_access_key: config.secretAccessKey,
        expires_in_seconds: options.expires_in_seconds,
        now: clock.now(),
        signed_headers: options.signed_headers,
      });
    },
  };
}

interface PinnedInspection {
  /** Quarantine object the copy was taken from; only used to derive the club of the clean target. */
  object_key: string;
  sha256: string;
  size_bytes: number;
  mime_type: ConnectorUploadMime;
  expires_at_ms: number;
  /** Private directory holding the one local copy; null for objects above the size limit (never copied). */
  local_dir: string | null;
}

function assertHttps(url: string): string {
  if (new URL(url).protocol !== "https:") throw new Error("Presigned object URLs must use HTTPS.");
  return url;
}

function assertConfig(config: S3QuarantineConfig): void {
  if (new URL(config.endpoint).protocol !== "https:") throw new Error("The S3 endpoint must use HTTPS.");
  for (const [name, value] of [["region", config.region], ["bucket", config.bucket], ["accessKeyId", config.accessKeyId], ["secretAccessKey", config.secretAccessKey]] as const) {
    if (!value.trim()) throw new Error(`S3 configuration value ${name} is missing.`);
  }
  const cleanPrefix = config.cleanPrefix ?? DEFAULT_CLEAN_PREFIX;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(cleanPrefix) || cleanPrefix === QUARANTINE_PREFIX) {
    throw new Error("The clean object prefix is invalid.");
  }
}

function localFile(dir: string): string {
  return join(dir, "object");
}

async function removeLocalCopy(dir: string | null): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Streams a local file in bounded chunks and closes it on end, error and cancel. */
function localStream(path: string): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  let position = 0;
  const close = async () => {
    const current = handle;
    handle = null;
    await current?.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        handle ??= await open(path, "r");
        const buffer = new Uint8Array(LOCAL_READ_CHUNK_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        await close();
        throw error;
      }
    },
    async cancel() {
      await close();
    },
  });
}

async function localRead(path: string, start: number, end: number): Promise<Uint8Array> {
  const length = Math.max(0, end - start);
  if (length === 0) return new Uint8Array(0);
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Production QuarantineObjectPort on S3-compatible storage (G.3). Objects under mcp-quarantine/ are
 * never downloadable. inspect() reads the quarantined object exactly once into a private, size-bounded
 * local copy and returns a new inspection_id for it; hash, format detection, ZIP inspection, the
 * malware scan (readInspected) and the promotion all read that one copy through its id, so every
 * check judges the same bytes. Copies are indexed by inspection_id, never by object key: a second
 * inspection of the same object gets its own copy and cannot replace or release another one. The
 * hash pin stays as an additional check on every later read of the copy.
 */
export class S3QuarantineObjectStore implements QuarantineObjectPort {
  readonly #backend: QuarantineObjectBackend;
  readonly #clock: FileClock;
  readonly #cleanPrefix: string;
  readonly #tempRoot: string;
  readonly #pins = new Map<string, PinnedInspection>();

  constructor(config: S3QuarantineConfig, options: { backend?: QuarantineObjectBackend; clock?: FileClock; temp_dir?: string } = {}) {
    assertConfig(config);
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#backend = options.backend ?? createBunS3Backend(config, this.#clock);
    this.#cleanPrefix = config.cleanPrefix ?? DEFAULT_CLEAN_PREFIX;
    this.#tempRoot = options.temp_dir ?? tmpdir();
  }

  async createPresignedUpload(input: {
    object_key: string;
    mime_type: ConnectorUploadMime;
    size_bytes: number;
    expires_in_seconds: number;
  }): Promise<{ url: string; required_headers: UploadRequiredHeaders }> {
    this.#quarantineKey(input.object_key);
    if (!Number.isInteger(input.size_bytes) || input.size_bytes < 1 || input.size_bytes > MAX_CONNECTOR_FILE_SIZE_BYTES) {
      throw new Error("The declared upload size is invalid.");
    }
    // Signed headers: the storage refuses a PUT with another length or type, and If-None-Match
    // makes the URL create the object at most once (no overwrite while the URL is valid).
    const requiredHeaders: UploadRequiredHeaders = {
      "Content-Type": input.mime_type,
      "Content-Length": String(input.size_bytes),
      "If-None-Match": "*",
    };
    const signedHeaders: Record<string, string> = { ...requiredHeaders };
    const url = this.#backend.presignPut(input.object_key, {
      expires_in_seconds: input.expires_in_seconds,
      signed_headers: signedHeaders,
    });
    return { url: assertHttps(url), required_headers: requiredHeaders };
  }

  async inspect(input: { object_key: string; declared_filename: string; declared_mime_type: ConnectorUploadMime }): Promise<ObjectInspectionResult> {
    const key = input.object_key;
    this.#quarantineKey(key);
    const inspectionId = randomUUID();
    const copy = await this.#copyOnce(key);
    try {
      const object: InspectableObject = copy.dir
        ? {
          size: copy.size,
          stream: () => localStream(localFile(copy.dir!)),
          read: (start, end) => localRead(localFile(copy.dir!), start, Math.min(end, copy.size)),
        }
        : {
          // Above the hard limit: never copied, never read; the inspection reports it as oversized.
          size: copy.size,
          stream: () => { throw new Error("Oversized objects are never read."); },
          read: async () => { throw new Error("Oversized objects are never read."); },
        };
      const inspection = await inspectStoredObject({
        object,
        declared_filename: input.declared_filename,
        declared_mime_type: input.declared_mime_type,
      });
      this.#pin(inspectionId, {
        object_key: key,
        sha256: inspection.sha256,
        size_bytes: inspection.size_bytes,
        mime_type: input.declared_mime_type,
        expires_at_ms: this.#clock.now().getTime() + UPLOAD_HANDLE_TTL_SECONDS * 1_000,
        local_dir: inspection.sha256 === UNINSPECTED_SHA256 ? null : copy.dir,
      });
      if (inspection.sha256 === UNINSPECTED_SHA256) await removeLocalCopy(copy.dir);
      return { ...inspection, inspection_id: inspectionId };
    } catch (error) {
      await removeLocalCopy(copy.dir);
      throw error;
    }
  }

  /**
   * Streams the inspected local copy and fails at the end if its bytes differ from the inspection.
   * Intended as the read callback of the malware scanner, so the scan judges exactly the inspected bytes.
   */
  readInspected(inspectionId: UUID): AsyncIterable<Uint8Array> {
    return this.#verifiedChunks(this.#requirePin(inspectionId));
  }

  async release(input: { inspection_id: UUID }): Promise<void> {
    const pin = this.#pins.get(input.inspection_id);
    this.#pins.delete(input.inspection_id);
    await removeLocalCopy(pin?.local_dir ?? null);
  }

  async delete(input: { object_key: string }): Promise<void> {
    const key = input.object_key;
    if (!QUARANTINE_KEY.test(key) && !key.startsWith(`${this.#cleanPrefix}/`)) {
      throw new Error("Only quarantine or clean connector objects can be deleted.");
    }
    // Local copies are left alone: they belong to their inspections and are released by them.
    await this.#backend.delete(key);
  }

  async promoteClean(input: { inspection_id: UUID; file_id: UUID }): Promise<{ object_key: string; inspection_id: UUID; sha256: string; size_bytes: number }> {
    if (!UUID_ONLY.test(input.file_id)) throw new Error("Invalid file id for promotion.");
    const pin = this.#requirePin(input.inspection_id);
    const clubId = this.#quarantineKey(pin.object_key);
    const target = `${this.#cleanPrefix}/${clubId}/${input.file_id}`;
    try {
      await this.#backend.write(target, this.#verifiedChunks(pin), {
        content_type: pin.mime_type,
        // Delivery is always a download, never inline rendering (passivation of SVG/HTML on delivery).
        content_disposition: "attachment",
      });
    } catch (error) {
      await this.#backend.delete(target).catch(() => undefined);
      throw error;
    }
    await this.release({ inspection_id: input.inspection_id });
    // #verifiedChunks failed the write unless the promoted bytes hash to exactly these values.
    return { object_key: target, inspection_id: input.inspection_id, sha256: pin.sha256, size_bytes: pin.size_bytes };
  }

  async createPresignedDownload(input: { object_key: string; expires_in_seconds: number }): Promise<{ url: string; expires_at: string }> {
    if (!input.object_key.startsWith(`${this.#cleanPrefix}/`)) {
      throw new Error("Only promoted clean objects can be downloaded.");
    }
    const url = this.#backend.presignGet(input.object_key, { expires_in_seconds: input.expires_in_seconds });
    const expiresAt = new Date(this.#clock.now().getTime() + input.expires_in_seconds * 1_000).toISOString();
    return { url: assertHttps(url), expires_at: expiresAt };
  }

  /** Validates a quarantine key and returns its club id. */
  #quarantineKey(objectKey: string): string {
    const match = QUARANTINE_KEY.exec(objectKey);
    if (!match?.[1]) throw new Error("Object key is outside the connector quarantine.");
    return match[1];
  }

  /**
   * Reads the object once into a new private directory (unique name, mode 0600 file). Stops and
   * discards the copy as soon as the hard size limit is exceeded; such an object is never copied.
   */
  async #copyOnce(objectKey: string): Promise<{ dir: string | null; size: number }> {
    const declaredSize = await this.#backend.size(objectKey);
    if (declaredSize > MAX_CONNECTOR_FILE_SIZE_BYTES) return { dir: null, size: declaredSize };
    const dir = await mkdtemp(join(this.#tempRoot, LOCAL_COPY_PREFIX));
    let size = 0;
    try {
      const file = await open(localFile(dir), "wx", 0o600);
      const reader = this.#backend.stream(objectKey).getReader();
      let finished = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          size += value.byteLength;
          if (size > MAX_CONNECTOR_FILE_SIZE_BYTES) break;
          await file.write(value);
        }
      } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await file.close();
      }
    } catch (error) {
      await removeLocalCopy(dir);
      throw error;
    }
    if (size > MAX_CONNECTOR_FILE_SIZE_BYTES) {
      await removeLocalCopy(dir);
      return { dir: null, size };
    }
    return { dir, size };
  }

  #pin(inspectionId: UUID, pin: PinnedInspection): void {
    const now = this.#clock.now().getTime();
    for (const [id, value] of this.#pins) {
      if (value.expires_at_ms <= now) this.#drop(id, value);
    }
    while (this.#pins.size >= MAX_PINNED_INSPECTIONS) {
      const oldest = this.#pins.entries().next();
      if (oldest.done) break;
      this.#drop(oldest.value[0], oldest.value[1]);
    }
    this.#pins.set(inspectionId, pin);
  }

  #drop(inspectionId: UUID, pin: PinnedInspection): void {
    this.#pins.delete(inspectionId);
    void removeLocalCopy(pin.local_dir).catch(() => undefined);
  }

  #requirePin(inspectionId: UUID): PinnedInspection & { local_dir: string } {
    const pin = this.#pins.get(inspectionId);
    if (!pin || pin.expires_at_ms <= this.#clock.now().getTime() || !pin.local_dir) {
      throw new Error("The inspection has no current local copy.");
    }
    return pin as PinnedInspection & { local_dir: string };
  }

  async *#verifiedChunks(pin: PinnedInspection & { local_dir: string }): AsyncGenerator<Uint8Array> {
    const hash = createHash("sha256");
    let size = 0;
    const reader = localStream(localFile(pin.local_dir)).getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        size += value.byteLength;
        if (size > pin.size_bytes) throw new Error("Inspected copy changed after inspection.");
        hash.update(value);
        yield value;
      }
    } finally {
      // Early exit (consumer aborted or size exceeded): release the file handle.
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (size !== pin.size_bytes || hash.digest("hex") !== pin.sha256) {
      throw new Error("Inspected copy changed after inspection.");
    }
  }
}
