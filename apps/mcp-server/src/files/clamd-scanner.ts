import { connect, type Socket } from "node:net";

import type { MalwareScannerPort } from "./types.ts";

export type ClamdObjectSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
/** Reads the local copy of one inspection for scanning, e.g. S3QuarantineObjectStore.readInspected. */
export type ClamdObjectReader = (inspectionId: string) => ClamdObjectSource | Promise<ClamdObjectSource>;

export interface ClamdScannerConfig {
  host: string;
  port: number;
  /** Overall deadline for connect, streaming and verdict. */
  timeout_ms?: number;
  /** Upper bound per INSTREAM chunk; must stay below clamd's StreamMaxLength. */
  chunk_bytes?: number;
}

export const DEFAULT_CLAMD_TIMEOUT_MS = 60_000;
export const DEFAULT_CLAMD_CHUNK_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024;

type ScanVerdict = "clean" | "infected" | "unavailable";

async function* chunksOf(source: ClamdObjectSource): AsyncGenerator<Uint8Array> {
  if (source instanceof ReadableStream) {
    const reader = source.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  yield* source;
}

function writeAll(socket: Socket, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

function lengthPrefix(length: number): Uint8Array {
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, length, false);
  return prefix;
}

/** Maps a clamd reply to a verdict; signatures never leave this function. */
export function parseClamdResponse(raw: string): ScanVerdict {
  const reply = raw.replace(/\0[\s\S]*$/u, "").trim();
  if (/^stream: OK$/u.test(reply)) return "clean";
  if (/^stream: .+ FOUND$/u.test(reply)) return "infected";
  return "unavailable";
}

/**
 * MalwareScannerPort against a clamd daemon over TCP (INSTREAM, G.3). Every transport problem,
 * timeout, truncated stream or unexpected reply is "unavailable", never "clean".
 */
export class ClamdMalwareScanner implements MalwareScannerPort {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #chunkBytes: number;

  constructor(config: ClamdScannerConfig, private readonly readObject: ClamdObjectReader) {
    if (!config.host.trim() || !Number.isInteger(config.port) || config.port <= 0 || config.port > 65_535) {
      throw new Error("clamd host and port are required.");
    }
    this.#host = config.host;
    this.#port = config.port;
    this.#timeoutMs = config.timeout_ms ?? DEFAULT_CLAMD_TIMEOUT_MS;
    this.#chunkBytes = config.chunk_bytes ?? DEFAULT_CLAMD_CHUNK_BYTES;
    if (this.#timeoutMs <= 0 || this.#chunkBytes <= 0) throw new Error("clamd timeout and chunk size must be positive.");
  }

  scan(input: { inspection_id: string }): Promise<ScanVerdict> {
    return new Promise<ScanVerdict>((resolve) => {
      let settled = false;
      let response = "";
      const socket = connect({ host: this.#host, port: this.#port });
      const finish = (verdict: ScanVerdict): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(verdict);
      };
      const timer = setTimeout(() => finish("unavailable"), this.#timeoutMs);

      socket.setNoDelay(true);
      socket.on("error", () => finish("unavailable"));
      socket.on("data", (data: Buffer) => {
        response += data.toString("utf8");
        if (response.includes("\0") || response.length > MAX_RESPONSE_BYTES) finish(parseClamdResponse(response));
      });
      // A reply without the NUL terminator still counts once the daemon closes the connection.
      socket.on("close", () => finish(response ? parseClamdResponse(response) : "unavailable"));
      socket.on("connect", () => {
        this.#stream(socket, input.inspection_id, () => settled).catch(() => finish("unavailable"));
      });
    });
  }

  async #stream(socket: Socket, inspectionId: string, isSettled: () => boolean): Promise<void> {
    await writeAll(socket, new TextEncoder().encode("zINSTREAM\0"));
    const source = await this.readObject(inspectionId);
    for await (const chunk of chunksOf(source)) {
      for (let offset = 0; offset < chunk.byteLength; offset += this.#chunkBytes) {
        if (isSettled()) return;
        const part = chunk.subarray(offset, offset + this.#chunkBytes);
        await writeAll(socket, lengthPrefix(part.byteLength));
        await writeAll(socket, part);
      }
    }
    // The zero-length terminator is only sent after the whole object was read without error;
    // a failing reader must never let clamd judge a truncated stream.
    if (!isSettled()) await writeAll(socket, lengthPrefix(0));
  }
}
