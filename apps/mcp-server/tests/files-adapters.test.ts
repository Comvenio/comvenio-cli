import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";

import { describe, expect, test } from "bun:test";

import { MAX_CONNECTOR_FILE_SIZE_BYTES, type ConnectorUploadMime } from "@comvenio/connector-contracts";

import {
  ClamdMalwareScanner,
  S3QuarantineObjectStore,
  UNINSPECTED_SHA256,
  extensionMatches,
  inspectStoredObject,
  parseClamdResponse,
  validateStoredObject,
  type FileClock,
  type InspectableObject,
  type QuarantineObjectBackend,
  type S3QuarantineConfig,
} from "../src/files/index.ts";

const CLUB = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const QUARANTINE_KEY = `mcp-quarantine/${CLUB}/${UPLOAD}`;

const encoder = new TextEncoder();

function bytes(...parts: Array<string | number[] | Uint8Array>): Uint8Array {
  const chunks = parts.map((part) => (typeof part === "string" ? encoder.encode(part) : Uint8Array.from(part)));
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function streamOf(data: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < data.byteLength; offset += chunkSize) controller.enqueue(data.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
}

function memoryObject(data: Uint8Array): InspectableObject {
  return {
    size: data.byteLength,
    stream: () => streamOf(data),
    read: async (start, end) => data.slice(start, end),
  };
}

function inspect(data: Uint8Array, mime: ConnectorUploadMime, filename = "upload.bin") {
  return inspectStoredObject({ object: memoryObject(data), declared_filename: filename, declared_mime_type: mime });
}

// --- Minimal ZIP writer (stored entries only), built in memory for the tests --------------------

interface ZipEntrySpec {
  name: string;
  data?: Uint8Array;
  flags?: number;
  method?: number;
  version_made_by?: number;
  external_attributes?: number;
  compressed_size?: number;
  uncompressed_size?: number;
  local_offset_of?: number;
}

function buildZip(entries: ZipEntrySpec[], options: { disk?: number } = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data ?? new Uint8Array(0);
    const local = new Uint8Array(30 + name.byteLength + data.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, entry.flags ?? 0x0800, true);
    localView.setUint16(8, entry.method ?? 0, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(data, 30 + name.byteLength);
    offsets.push(offset);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, entry.version_made_by ?? (3 << 8) | 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, entry.flags ?? 0x0800, true);
    view.setUint16(10, entry.method ?? 0, true);
    view.setUint32(20, entry.compressed_size ?? data.byteLength, true);
    view.setUint32(24, entry.uncompressed_size ?? data.byteLength, true);
    view.setUint16(28, name.byteLength, true);
    view.setUint32(38, entry.external_attributes ?? (0o100644 << 16) >>> 0, true);
    view.setUint32(42, entry.local_offset_of === undefined ? offset : offsets[entry.local_offset_of] ?? 0, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength;
  }
  const directorySize = centrals.reduce((sum, central) => sum + central.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, options.disk ?? 0, true);
  eocdView.setUint16(6, options.disk ?? 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, offset, true);
  return bytes(...locals, ...centrals, eocd);
}

async function zipInspection(entries: ZipEntrySpec[], options: { disk?: number } = {}) {
  const inspection = await inspect(buildZip(entries, options), "application/zip", "archive.zip");
  expect(inspection.detected_mime_type).toBe("application/zip");
  if (!inspection.zip) throw new Error("expected a ZIP inspection");
  return inspection.zip;
}

// --- Minimal OLE2 compound file (512-byte sectors: header, FAT, one directory sector) -----------

function buildCompoundFile(streamName: string): Uint8Array {
  const file = new Uint8Array(512 * 3);
  const view = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x003e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(68, 0xfffffffe, true);
  for (let index = 0; index < 109; index += 1) view.setUint32(76 + index * 4, index === 0 ? 0 : 0xffffffff, true);
  for (let index = 0; index < 128; index += 1) view.setUint32(512 + index * 4, index === 0 ? 0xfffffffd : index === 1 ? 0xfffffffe : 0xffffffff, true);
  const writeEntry = (slot: number, name: string, type: number): void => {
    const base = 1024 + slot * 128;
    for (let index = 0; index < name.length; index += 1) view.setUint16(base + index * 2, name.charCodeAt(index), true);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    file[base + 66] = type;
  };
  writeEntry(0, "Root Entry", 5);
  writeEntry(1, streamName, 2);
  return file;
}

describe("stored object inspection", () => {
  test("computes the SHA-256 as lowercase hex over the exact bytes", async () => {
    const data = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest-of-png");
    const inspection = await inspect(data, "image/png", "logo.png");
    expect(inspection.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(inspection.size_bytes).toBe(data.byteLength);
  });

  test("detects allowed types from magic bytes", async () => {
    const cases: Array<[Uint8Array, ConnectorUploadMime, string]> = [
      [bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "x"), "image/png", "a.png"],
      [bytes([0xff, 0xd8, 0xff, 0xe0], "jfif"), "image/jpeg", "a.jpg"],
      [bytes("GIF89a", [0, 0]), "image/gif", "a.gif"],
      [bytes("%PDF-1.7\n", [0xe2, 0xe3]), "application/pdf", "a.pdf"],
      [bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp", "a.webp"],
      [bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), "audio/wav", "a.wav"],
      [bytes("RIFF", [0, 0, 0, 0], "AVI LIST"), "video/x-msvideo", "a.avi"],
      [bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0]), "video/mp4", "a.mp4"],
      [bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0]), "audio/mp4", "a.m4a"],
      [bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 2, 0]), "video/quicktime", "a.mov"],
      [bytes([0, 0, 0, 0x14], "ftyp3gp4", [0, 0, 2, 0]), "video/3gpp", "a.3gp"],
      [bytes([0, 0, 1, 0xba, 0x44]), "video/mpeg", "a.mpg"],
      [bytes([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x84], "webm", [0x42, 0x87]), "video/webm", "a.webm"],
      [bytes([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88], "matroska"), "video/x-matroska", "a.mkv"],
      [bytes("OggS", [0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0x01], "vorbis"), "audio/ogg", "a.ogg"],
      [bytes("OggS", [0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0x80], "theora"), "video/ogg", "a.ogv"],
      [bytes("ID3", [3, 0, 0, 0, 0, 0, 10], new Array(10).fill(0), [0xff, 0xfb, 0x90, 0x00]), "audio/mpeg", "a.mp3"],
      [bytes([0xff, 0xfb, 0x90, 0x00, 0, 0]), "audio/mpeg", "a.mp3"],
      [bytes([0xff, 0xf1, 0x50, 0x80, 0, 0]), "audio/aac", "a.aac"],
      [buildCompoundFile("WordDocument"), "application/msword", "a.doc"],
      [buildCompoundFile("Workbook"), "application/vnd.ms-excel", "a.xls"],
      [buildCompoundFile("PowerPoint Document"), "application/vnd.ms-powerpoint", "a.ppt"],
    ];
    for (const [data, mime, filename] of cases) {
      const inspection = await inspect(data, mime, filename);
      expect({ mime, detected: inspection.detected_mime_type, magic: inspection.magic_bytes_match })
        .toEqual({ mime, detected: mime, magic: true });
    }
  });

  test("reports the real type when the declared type does not match the bytes", async () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "x");
    const inspection = await inspect(png, "image/jpeg", "photo.jpg");
    expect(inspection.detected_mime_type).toBe("image/png");
    expect(validateStoredObject({
      inspection,
      declared_mime_type: "image/jpeg",
      declared_size_bytes: png.byteLength,
      completion_size_bytes: png.byteLength,
      completion_sha256: inspection.sha256,
    })).toBe("MIME_MISMATCH");
    const doc = await inspect(buildCompoundFile("Workbook"), "application/msword", "a.doc");
    expect(doc.detected_mime_type).toBe("application/vnd.ms-excel");
  });

  test("unknown binary content is octet-stream without a magic match", async () => {
    const inspection = await inspect(bytes([0x00, 0xfe, 0x13, 0x37, 0x00]), "image/png", "a.png");
    expect(inspection.detected_mime_type).toBe("application/octet-stream");
    expect(inspection.magic_bytes_match).toBe(false);
  });

  test("objects above the hard size limit are never hashed or parsed", async () => {
    let streamed = false;
    const inspection = await inspectStoredObject({
      object: {
        size: MAX_CONNECTOR_FILE_SIZE_BYTES + 1,
        stream: () => {
          streamed = true;
          return streamOf(new Uint8Array(1));
        },
        read: async () => new Uint8Array(0),
      },
      declared_filename: "big.mp4",
      declared_mime_type: "video/mp4",
    });
    expect(streamed).toBe(false);
    expect(inspection.sha256).toBe(UNINSPECTED_SHA256);
    expect(inspection.magic_bytes_match).toBe(false);
  });

  test("matches the filename extension against the declared type", () => {
    expect(extensionMatches("Foto.JPG", "image/jpeg")).toBe(true);
    expect(extensionMatches("foto.jpeg", "image/jpeg")).toBe(true);
    expect(extensionMatches("mitglieder.csv", "text/plain")).toBe(true);
    expect(extensionMatches("archiv.zip", "application/x-zip-compressed")).toBe(true);
    expect(extensionMatches("foto.png.exe", "image/png")).toBe(false);
    expect(extensionMatches("foto", "image/png")).toBe(false);
    expect(extensionMatches(".png", "image/png")).toBe(false);
    expect(extensionMatches("foto.", "image/png")).toBe(false);
  });

  test("validates text types: UTF-8 text, JSON syntax and binary content", async () => {
    expect((await inspect(bytes("Name;Rolle\nAnna;Trainerin\n"), "text/plain", "a.csv")).detected_mime_type).toBe("text/plain");
    const json = await inspect(bytes('{"members":[1,2]}'), "application/json", "a.json");
    expect(json.detected_mime_type).toBe("application/json");
    const brokenJson = await inspect(bytes('{"members":'), "application/json", "a.json");
    expect(brokenJson.detected_mime_type).toBe("text/plain");
    const invalidUtf8 = await inspect(bytes([0x41, 0xc3, 0x28]), "text/plain", "a.txt");
    expect(invalidUtf8.magic_bytes_match).toBe(false);
    const withNul = await inspect(bytes("abc", [0], "def"), "text/plain", "a.txt");
    expect(withNul.detected_mime_type).toBe("application/octet-stream");
  });

  test("accepts only passive SVG and HTML documents", async () => {
    const passiveSvg = await inspect(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'), "image/svg+xml", "logo.svg");
    expect(passiveSvg.detected_mime_type).toBe("image/svg+xml");
    expect(passiveSvg.active_content_passivated).toBe(true);

    const activeSvgs = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x61;script:alert(1)"><text>x</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
    ];
    for (const svg of activeSvgs) {
      const inspection = await inspect(bytes(svg), "image/svg+xml", "logo.svg");
      expect({ svg, passivated: inspection.active_content_passivated }).toEqual({ svg, passivated: false });
    }
    const entitySvg = await inspect(bytes('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>'), "image/svg+xml", "logo.svg");
    expect(entitySvg.detected_mime_type).not.toBe("image/svg+xml");
    expect(entitySvg.active_content_passivated).toBe(false);

    const passiveHtml = await inspect(bytes("<!doctype html><html><body><p>Hallo</p></body></html>"), "text/html", "seite.html");
    expect(passiveHtml.detected_mime_type).toBe("text/html");
    expect(passiveHtml.active_content_passivated).toBe(true);
    for (const html of [
      "<!doctype html><html><body><script>x()</script></body></html>",
      '<!doctype html><html><body><img src="x" onerror="x()"></body></html>',
      '<!doctype html><html><body><iframe srcdoc="x"></iframe></body></html>',
      '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://x.test"></head></html>',
    ]) {
      const inspection = await inspect(bytes(html), "text/html", "seite.html");
      expect({ html, passivated: inspection.active_content_passivated }).toEqual({ html, passivated: false });
    }
  });

  test("non-active types never require passivation", async () => {
    const inspection = await inspect(bytes("<script>alert(1)</script>"), "text/plain", "notiz.txt");
    expect(inspection.detected_mime_type).toBe("text/plain");
    expect(inspection.active_content_passivated).toBe(true);
  });
});

describe("ZIP inspection", () => {
  test("a clean archive reports every ZipInspection field", async () => {
    const zip = await zipInspection([
      { name: "daten/" },
      { name: "daten/mitglieder.csv", data: bytes("a;b\n") },
      { name: "liesmich.txt", data: bytes("hallo") },
    ]);
    expect(zip).toEqual({
      entry_count: 3,
      total_uncompressed_bytes: 9,
      largest_entry_bytes: 5,
      maximum_compression_ratio: 1,
      maximum_directory_depth: 1,
      maximum_normalized_path_length: "daten/mitglieder.csv".length,
      has_absolute_path: false,
      has_parent_traversal: false,
      has_symlink: false,
      has_hardlink: false,
      has_device_entry: false,
      is_encrypted: false,
      is_multi_disk: false,
      has_nested_archive: false,
    });
  });

  test("flags every forbidden entry type", async () => {
    expect((await zipInspection([{ name: "../../etc/passwd", data: bytes("x") }])).has_parent_traversal).toBe(true);
    expect((await zipInspection([{ name: "a\\..\\..\\b.txt", data: bytes("x") }])).has_parent_traversal).toBe(true);
    expect((await zipInspection([{ name: "/etc/passwd", data: bytes("x") }])).has_absolute_path).toBe(true);
    expect((await zipInspection([{ name: "C:/Windows/x.txt", data: bytes("x") }])).has_absolute_path).toBe(true);
    expect((await zipInspection([{ name: "link", data: bytes("/etc/passwd"), external_attributes: (0o120777 << 16) >>> 0 }])).has_symlink).toBe(true);
    expect((await zipInspection([{ name: "dev", external_attributes: (0o020644 << 16) >>> 0 }])).has_device_entry).toBe(true);
    expect((await zipInspection([
      { name: "a.txt", data: bytes("x") },
      { name: "b.txt", data: bytes("x"), local_offset_of: 0 },
    ])).has_hardlink).toBe(true);
    expect((await zipInspection([{ name: "inner.zip", data: bytes("PK") }])).has_nested_archive).toBe(true);
    expect((await zipInspection([{ name: "backup.tar.gz", data: bytes("x") }])).has_nested_archive).toBe(true);
    expect((await zipInspection([{ name: "geheim.txt", data: bytes("x"), flags: 0x0801 }])).is_encrypted).toBe(true);
    expect((await zipInspection([{ name: "aes.txt", data: bytes("x"), method: 99 }])).is_encrypted).toBe(true);
  });

  test("multi-disk archives are detected from the end record", async () => {
    const inspection = await inspect(buildZip([{ name: "a.txt", data: bytes("x") }], { disk: 1 }), "application/zip", "a.zip");
    expect(inspection.zip?.is_multi_disk).toBe(true);
  });

  test("numeric limits: depth, path length and compression ratio", async () => {
    expect((await zipInspection([{ name: "a/b/c/d/e.txt", data: bytes("x") }])).maximum_directory_depth).toBe(4);
    expect((await zipInspection([{ name: `${"x".repeat(241)}.txt`, data: bytes("x") }])).maximum_normalized_path_length).toBe(245);
    const bomb = await zipInspection([{ name: "bomb.txt", data: bytes("0123456789"), compressed_size: 10, uncompressed_size: 10_000 }]);
    expect(bomb.maximum_compression_ratio).toBe(1_000);
  });

  test("feeds validateStoredObject: clean passes, unsafe is rejected", async () => {
    const clean = buildZip([{ name: "a.txt", data: bytes("x") }]);
    const unsafe = buildZip([{ name: "../a.txt", data: bytes("x") }]);
    for (const [data, expected] of [[clean, null], [unsafe, "UNSAFE_ARCHIVE"]] as const) {
      const inspection = await inspect(data, "application/x-zip-compressed", "archiv.zip");
      expect(inspection.detected_mime_type).toBe("application/x-zip-compressed");
      expect(validateStoredObject({
        inspection,
        declared_mime_type: "application/x-zip-compressed",
        declared_size_bytes: data.byteLength,
        completion_size_bytes: data.byteLength,
        completion_sha256: inspection.sha256,
      })).toBe(expected);
    }
  });

  test("a corrupt ZIP declared as ZIP has no inspection and is rejected fail-closed", async () => {
    const corrupt = bytes([0x50, 0x4b, 0x03, 0x04], new Array(40).fill(0));
    const inspection = await inspect(corrupt, "application/zip", "a.zip");
    expect(inspection.zip).toBeNull();
    expect(validateStoredObject({
      inspection,
      declared_mime_type: "application/zip",
      declared_size_bytes: corrupt.byteLength,
      completion_size_bytes: corrupt.byteLength,
      completion_sha256: inspection.sha256,
    })).toBe("UNSAFE_ARCHIVE");
  });

  test("office containers are told apart from plain ZIP", async () => {
    const docx = buildZip([{ name: "[Content_Types].xml", data: bytes("<Types/>") }, { name: "word/document.xml", data: bytes("<w/>") }]);
    const inspection = await inspect(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "brief.docx");
    expect(inspection.detected_mime_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(inspection.zip).toBeNull();
    const asZip = await inspect(docx, "application/zip", "brief.zip");
    expect(asZip.detected_mime_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const odt = buildZip([{ name: "mimetype", data: bytes("application/vnd.oasis.opendocument.text") }, { name: "content.xml", data: bytes("<x/>") }]);
    expect((await inspect(odt, "application/vnd.oasis.opendocument.text", "brief.odt")).detected_mime_type)
      .toBe("application/vnd.oasis.opendocument.text");
  });
});

// --- S3 store against an in-memory backend ------------------------------------------------------

class MemoryBackend implements QuarantineObjectBackend {
  readonly objects = new Map<string, { data: Uint8Array; content_type?: string; content_disposition?: string }>();

  #get(key: string): Uint8Array {
    const object = this.objects.get(key);
    if (!object) throw new Error(`missing ${key}`);
    return object.data;
  }

  async size(key: string) { return this.#get(key).byteLength; }
  stream(key: string) { return streamOf(this.#get(key)); }
  async read(key: string, start: number, end: number) { return this.#get(key).slice(start, end); }
  async write(key: string, source: AsyncIterable<Uint8Array>, options: { content_type: string; content_disposition: string }) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    this.objects.set(key, { data: bytes(...chunks), ...options });
  }
  async delete(key: string) { this.objects.delete(key); }
  presign(key: string, options: { method: "GET" | "PUT"; expires_in_seconds: number; content_type?: string }) {
    const type = options.content_type ? `&type=${encodeURIComponent(options.content_type)}` : "";
    return `https://objects.example.test/${key}?method=${options.method}&expires=${options.expires_in_seconds}${type}`;
  }
}

const CONFIG: S3QuarantineConfig = {
  endpoint: "https://objects.example.test",
  region: "auto",
  bucket: "connector-files",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

const FIXED_CLOCK: FileClock = { now: () => new Date("2026-09-29T10:00:00.000Z") };

function store() {
  const backend = new MemoryBackend();
  return { backend, objects: new S3QuarantineObjectStore(CONFIG, { backend, clock: FIXED_CLOCK }) };
}

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image-body");

describe("S3QuarantineObjectStore", () => {
  test("rejects insecure configuration", () => {
    expect(() => new S3QuarantineObjectStore({ ...CONFIG, endpoint: "http://objects.example.test" }, { backend: new MemoryBackend() })).toThrow();
    expect(() => new S3QuarantineObjectStore({ ...CONFIG, cleanPrefix: "mcp-quarantine" }, { backend: new MemoryBackend() })).toThrow();
  });

  test("presigns uploads only inside the quarantine prefix, bound to the MIME type", async () => {
    const { objects } = store();
    const { url } = await objects.createPresignedUpload({ object_key: QUARANTINE_KEY, mime_type: "image/png", size_bytes: PNG.byteLength, expires_in_seconds: 900 });
    expect(url).toContain("method=PUT");
    expect(url).toContain(`type=${encodeURIComponent("image/png")}`);
    await expect(objects.createPresignedUpload({ object_key: "mcp-clean/x", mime_type: "image/png", size_bytes: 1, expires_in_seconds: 900 })).rejects.toThrow();
  });

  test("promotes exactly the inspected bytes as an attachment", async () => {
    const { backend, objects } = store();
    backend.objects.set(QUARANTINE_KEY, { data: PNG });
    const inspection = await objects.inspect({ object_key: QUARANTINE_KEY, declared_filename: "logo.png", declared_mime_type: "image/png" });
    expect(inspection.detected_mime_type).toBe("image/png");
    const promoted = await objects.promoteClean({ quarantine_object_key: QUARANTINE_KEY, file_id: FILE });
    expect(promoted.object_key).toBe(`mcp-clean/${CLUB}/${FILE}`);
    const clean = backend.objects.get(promoted.object_key);
    expect(clean?.data).toEqual(PNG);
    expect(clean?.content_type).toBe("image/png");
    expect(clean?.content_disposition).toBe("attachment");
  });

  test("refuses promotion without inspection or after the object was replaced", async () => {
    const { backend, objects } = store();
    backend.objects.set(QUARANTINE_KEY, { data: PNG });
    await expect(objects.promoteClean({ quarantine_object_key: QUARANTINE_KEY, file_id: FILE })).rejects.toThrow();

    await objects.inspect({ object_key: QUARANTINE_KEY, declared_filename: "logo.png", declared_mime_type: "image/png" });
    backend.objects.set(QUARANTINE_KEY, { data: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "swapped!!!") });
    await expect(objects.promoteClean({ quarantine_object_key: QUARANTINE_KEY, file_id: FILE })).rejects.toThrow();
    expect(backend.objects.has(`mcp-clean/${CLUB}/${FILE}`)).toBe(false);

    const scanned: Uint8Array[] = [];
    await expect((async () => {
      for await (const chunk of objects.readInspected(QUARANTINE_KEY)) scanned.push(chunk);
    })()).rejects.toThrow();
  });

  test("downloads only clean objects with a computed expiry", async () => {
    const { objects } = store();
    await expect(objects.createPresignedDownload({ object_key: QUARANTINE_KEY, expires_in_seconds: 300 })).rejects.toThrow();
    const download = await objects.createPresignedDownload({ object_key: `mcp-clean/${CLUB}/${FILE}`, expires_in_seconds: 300 });
    expect(download.url).toContain("method=GET");
    expect(download.expires_at).toBe("2026-09-29T10:05:00.000Z");
  });

  test("deletes quarantine objects and rejects foreign keys", async () => {
    const { backend, objects } = store();
    backend.objects.set(QUARANTINE_KEY, { data: PNG });
    await objects.delete({ object_key: QUARANTINE_KEY });
    expect(backend.objects.has(QUARANTINE_KEY)).toBe(false);
    await expect(objects.delete({ object_key: "other/key" })).rejects.toThrow();
  });
});

// --- clamd INSTREAM against a local fake daemon -------------------------------------------------

type FakeBehavior = "ok" | "found" | "abort" | "silent";

async function fakeClamd(behavior: FakeBehavior) {
  const state = { command: "", chunks: [] as number[], payload: new Uint8Array(0), terminated: false };
  const server: Server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("error", () => undefined);
    socket.on("data", (data: Buffer) => {
      if (behavior === "abort") {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, data]);
      const command = "zINSTREAM\0";
      if (buffer.length < command.length) return;
      state.command = buffer.subarray(0, command.length).toString("utf8");
      const chunks: number[] = [];
      const payload: Buffer[] = [];
      let offset = command.length;
      while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        if (length === 0) {
          state.chunks = chunks;
          state.payload = new Uint8Array(Buffer.concat(payload));
          state.terminated = true;
          if (behavior === "ok") socket.end("stream: OK\0");
          if (behavior === "found") socket.end("stream: Eicar-Test-Signature FOUND\0");
          return;
        }
        if (offset + 4 + length > buffer.length) return;
        chunks.push(length);
        payload.push(buffer.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const OBJECT = bytes("0123456789");

describe("ClamdMalwareScanner", () => {
  test("parses clamd replies without exposing signatures", () => {
    expect(parseClamdResponse("stream: OK\0")).toBe("clean");
    expect(parseClamdResponse("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toBe("infected");
    expect(parseClamdResponse("INSTREAM size limit exceeded. ERROR\0")).toBe("unavailable");
    expect(parseClamdResponse("")).toBe("unavailable");
  });

  test("streams length-prefixed chunks with a zero terminator and reports clean", async () => {
    const daemon = await fakeClamd("ok");
    try {
      const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port: daemon.port, chunk_bytes: 4, timeout_ms: 2_000 }, () => streamOf(OBJECT, 10));
      expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("clean");
      expect(daemon.state.command).toBe("zINSTREAM\0");
      expect(daemon.state.chunks).toEqual([4, 4, 2]);
      expect(daemon.state.payload).toEqual(OBJECT as Uint8Array<ArrayBuffer>);
      expect(daemon.state.terminated).toBe(true);
    } finally {
      await daemon.close();
    }
  });

  test("FOUND is infected", async () => {
    const daemon = await fakeClamd("found");
    try {
      const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port: daemon.port, timeout_ms: 2_000 }, () => streamOf(OBJECT));
      expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("infected");
    } finally {
      await daemon.close();
    }
  });

  test("an aborted connection is unavailable", async () => {
    const daemon = await fakeClamd("abort");
    try {
      const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port: daemon.port, timeout_ms: 2_000 }, () => streamOf(OBJECT));
      expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("unavailable");
    } finally {
      await daemon.close();
    }
  });

  test("a silent daemon runs into the timeout and is unavailable", async () => {
    const daemon = await fakeClamd("silent");
    try {
      const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port: daemon.port, timeout_ms: 150 }, () => streamOf(OBJECT));
      expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("unavailable");
    } finally {
      await daemon.close();
    }
  });

  test("a refused connection is unavailable", async () => {
    const daemon = await fakeClamd("ok");
    const port = daemon.port;
    await daemon.close();
    const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port, timeout_ms: 2_000 }, () => streamOf(OBJECT));
    expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("unavailable");
  });

  test("a failing reader never sends the terminator and is unavailable", async () => {
    const daemon = await fakeClamd("ok");
    try {
      async function* failing(): AsyncGenerator<Uint8Array> {
        yield bytes("partial");
        throw new Error("object changed");
      }
      const scanner = new ClamdMalwareScanner({ host: "127.0.0.1", port: daemon.port, timeout_ms: 2_000 }, () => failing());
      expect(await scanner.scan({ object_key: QUARANTINE_KEY })).toBe("unavailable");
      expect(daemon.state.terminated).toBe(false);
    } finally {
      await daemon.close();
    }
  });
});
