import { createHash } from "node:crypto";

import { UPLOAD_HANDLE_TTL_SECONDS, type ConnectorUploadMime, type UUID } from "@comvenio/connector-contracts";

import { inspectStoredObject } from "./object-inspection.ts";
import type { FileClock, QuarantineObjectPort, StoredObjectInspection } from "./types.ts";

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
  /** Returns the bytes in [start, end). */
  read(objectKey: string, start: number, end: number): Promise<Uint8Array>;
  write(objectKey: string, source: AsyncIterable<Uint8Array>, options: { content_type: string; content_disposition: string }): Promise<void>;
  delete(objectKey: string): Promise<void>;
  presign(objectKey: string, options: { method: "GET" | "PUT"; expires_in_seconds: number; content_type?: string }): string;
}

const QUARANTINE_PREFIX = "mcp-quarantine";
const DEFAULT_CLEAN_PREFIX = "mcp-clean";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const QUARANTINE_KEY = new RegExp(`^${QUARANTINE_PREFIX}/(${UUID_PATTERN})/(${UUID_PATTERN})$`, "iu");
const UUID_ONLY = new RegExp(`^${UUID_PATTERN}$`, "iu");
export const MAX_PINNED_INSPECTIONS = 10_000;
const SYSTEM_CLOCK: FileClock = { now: () => new Date() };

export function createBunS3Backend(config: S3QuarantineConfig): QuarantineObjectBackend {
  const client = new Bun.S3Client({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  return {
    async size(objectKey) {
      return (await client.file(objectKey).stat()).size;
    },
    stream(objectKey) {
      return client.file(objectKey).stream();
    },
    async read(objectKey, start, end) {
      return new Uint8Array(await client.file(objectKey).slice(start, end).arrayBuffer());
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
    presign(objectKey, options) {
      return client.file(objectKey).presign({
        method: options.method,
        expiresIn: options.expires_in_seconds,
        ...(options.content_type ? { type: options.content_type } : {}),
      });
    },
  };
}

interface PinnedInspection {
  sha256: string;
  size_bytes: number;
  mime_type: ConnectorUploadMime;
  expires_at_ms: number;
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

/**
 * Production QuarantineObjectPort on S3-compatible storage (G.3). Objects under mcp-quarantine/ are
 * never downloadable; promotion copies exactly the inspected bytes (hash-pinned) to the clean prefix.
 */
export class S3QuarantineObjectStore implements QuarantineObjectPort {
  readonly #backend: QuarantineObjectBackend;
  readonly #clock: FileClock;
  readonly #cleanPrefix: string;
  readonly #pins = new Map<string, PinnedInspection>();

  constructor(config: S3QuarantineConfig, options: { backend?: QuarantineObjectBackend; clock?: FileClock } = {}) {
    assertConfig(config);
    this.#backend = options.backend ?? createBunS3Backend(config);
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#cleanPrefix = config.cleanPrefix ?? DEFAULT_CLEAN_PREFIX;
  }

  async createPresignedUpload(input: {
    object_key: string;
    mime_type: ConnectorUploadMime;
    size_bytes: number;
    expires_in_seconds: number;
  }): Promise<{ url: string }> {
    this.#quarantineKey(input.object_key);
    const url = this.#backend.presign(input.object_key, {
      method: "PUT",
      expires_in_seconds: input.expires_in_seconds,
      content_type: input.mime_type,
    });
    return { url: assertHttps(url) };
  }

  async inspect(input: { object_key: string; declared_filename: string; declared_mime_type: ConnectorUploadMime }): Promise<StoredObjectInspection> {
    const key = input.object_key;
    this.#quarantineKey(key);
    const size = await this.#backend.size(key);
    const inspection = await inspectStoredObject({
      object: {
        size,
        stream: () => this.#backend.stream(key),
        read: (start, end) => this.#backend.read(key, start, end),
      },
      declared_filename: input.declared_filename,
      declared_mime_type: input.declared_mime_type,
    });
    this.#pin(key, {
      sha256: inspection.sha256,
      size_bytes: inspection.size_bytes,
      mime_type: input.declared_mime_type,
      expires_at_ms: this.#clock.now().getTime() + UPLOAD_HANDLE_TTL_SECONDS * 1_000,
    });
    return inspection;
  }

  /**
   * Streams the quarantined object and fails at the end if the bytes differ from the last inspection.
   * Intended as the read callback of the malware scanner, so a replaced object is never reported clean.
   */
  readInspected(objectKey: string): AsyncIterable<Uint8Array> {
    this.#quarantineKey(objectKey);
    return this.#verifiedChunks(objectKey, this.#requirePin(objectKey));
  }

  async delete(input: { object_key: string }): Promise<void> {
    const key = input.object_key;
    if (!QUARANTINE_KEY.test(key) && !key.startsWith(`${this.#cleanPrefix}/`)) {
      throw new Error("Only quarantine or clean connector objects can be deleted.");
    }
    this.#pins.delete(key);
    await this.#backend.delete(key);
  }

  async promoteClean(input: { quarantine_object_key: string; file_id: UUID }): Promise<{ object_key: string }> {
    const clubId = this.#quarantineKey(input.quarantine_object_key);
    if (!UUID_ONLY.test(input.file_id)) throw new Error("Invalid file id for promotion.");
    const pin = this.#requirePin(input.quarantine_object_key);
    const target = `${this.#cleanPrefix}/${clubId}/${input.file_id}`;
    try {
      await this.#backend.write(target, this.#verifiedChunks(input.quarantine_object_key, pin), {
        content_type: pin.mime_type,
        // Delivery is always a download, never inline rendering (passivation of SVG/HTML on delivery).
        content_disposition: "attachment",
      });
    } catch (error) {
      await this.#backend.delete(target).catch(() => undefined);
      throw error;
    }
    this.#pins.delete(input.quarantine_object_key);
    return { object_key: target };
  }

  async createPresignedDownload(input: { object_key: string; expires_in_seconds: number }): Promise<{ url: string; expires_at: string }> {
    if (!input.object_key.startsWith(`${this.#cleanPrefix}/`)) {
      throw new Error("Only promoted clean objects can be downloaded.");
    }
    const url = this.#backend.presign(input.object_key, { method: "GET", expires_in_seconds: input.expires_in_seconds });
    const expiresAt = new Date(this.#clock.now().getTime() + input.expires_in_seconds * 1_000).toISOString();
    return { url: assertHttps(url), expires_at: expiresAt };
  }

  /** Validates a quarantine key and returns its club id. */
  #quarantineKey(objectKey: string): string {
    const match = QUARANTINE_KEY.exec(objectKey);
    if (!match?.[1]) throw new Error("Object key is outside the connector quarantine.");
    return match[1];
  }

  #pin(objectKey: string, pin: PinnedInspection): void {
    const now = this.#clock.now().getTime();
    for (const [key, value] of this.#pins) {
      if (value.expires_at_ms <= now) this.#pins.delete(key);
    }
    this.#pins.delete(objectKey);
    while (this.#pins.size >= MAX_PINNED_INSPECTIONS) {
      const oldest = this.#pins.keys().next();
      if (oldest.done) break;
      this.#pins.delete(oldest.value);
    }
    this.#pins.set(objectKey, pin);
  }

  #requirePin(objectKey: string): PinnedInspection {
    const pin = this.#pins.get(objectKey);
    if (!pin || pin.expires_at_ms <= this.#clock.now().getTime()) {
      throw new Error("The quarantine object has no current inspection.");
    }
    return pin;
  }

  async *#verifiedChunks(objectKey: string, pin: PinnedInspection): AsyncGenerator<Uint8Array> {
    const hash = createHash("sha256");
    let size = 0;
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
        if (size > pin.size_bytes) throw new Error("Quarantine object changed after inspection.");
        hash.update(value);
        yield value;
      }
    } finally {
      // Early exit (consumer aborted or size exceeded): release the underlying connection.
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (size !== pin.size_bytes || hash.digest("hex") !== pin.sha256) {
      throw new Error("Quarantine object changed after inspection.");
    }
  }
}
