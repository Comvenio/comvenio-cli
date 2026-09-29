import { createHash } from "node:crypto";

import { MAX_CONNECTOR_FILE_SIZE_BYTES, type ConnectorUploadMime } from "@comvenio/connector-contracts";

import type { StoredObjectInspection, ZipInspection } from "./types.ts";
import {
  inspectZipDirectory,
  readStoredEntry,
  readZipDirectory,
  ZipFormatError,
  type RandomAccessObject,
  type ZipDirectory,
} from "./zip-inspection.ts";

// Fixed upper bounds against memory abuse; all independent of the declared size.
export const INSPECTION_HEAD_BYTES = 64 * 1024;
export const MAX_TEXT_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const MAX_CFB_DIRECTORY_SECTORS = 64;
export const MAX_CFB_DIFAT_SECTORS = 64;
/** Placeholder hash for objects above the hard size limit; they are never hashed. */
export const UNINSPECTED_SHA256 = "0".repeat(64);

const OCTET_STREAM = "application/octet-stream";
const ZIP_MIMES: readonly string[] = ["application/zip", "application/x-zip-compressed"];
const TEXT_DOCUMENT_MIMES = new Set<string>(["application/json", "image/svg+xml", "text/html"]);
const ACTIVE_CONTENT_MIMES = new Set<string>(["image/svg+xml", "text/html"]);

/** Accepted filename extensions per declared MIME type (lower case, without dot). */
export const UPLOAD_EXTENSIONS: Readonly<Record<ConnectorUploadMime, readonly string[]>> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg", "jpe"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "text", "csv", "tsv"],
  "application/json": ["json"],
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.oasis.opendocument.text": ["odt"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/html": ["html", "htm"],
  "video/mp4": ["mp4", "m4v"],
  "video/mpeg": ["mpeg", "mpg"],
  "video/webm": ["webm"],
  "video/ogg": ["ogv", "ogg"],
  "video/quicktime": ["mov", "qt"],
  "video/x-msvideo": ["avi"],
  "video/x-matroska": ["mkv"],
  "video/3gpp": ["3gp"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/ogg": ["ogg", "oga", "opus"],
  "audio/wav": ["wav"],
  "audio/webm": ["webm", "weba"],
  "audio/aac": ["aac"],
};

export interface InspectableObject extends RandomAccessObject {
  stream(): ReadableStream<Uint8Array>;
}

export function extensionMatches(filename: string, mimeType: ConnectorUploadMime): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return false;
  return UPLOAD_EXTENSIONS[mimeType].includes(filename.slice(dot + 1).toLowerCase());
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function matches(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.byteLength < end) return "";
  return String.fromCharCode(...bytes.subarray(start, end));
}

function includesSequence(bytes: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let index = 0; index + needle.length <= bytes.byteLength; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/** Serves reads from the already streamed head and falls back to ranged reads. */
function headCachedReader(object: RandomAccessObject, head: Uint8Array, size: number): RandomAccessObject {
  return {
    size,
    async read(start, end) {
      const boundedEnd = Math.min(end, size);
      if (start >= boundedEnd) return new Uint8Array(0);
      if (boundedEnd <= head.byteLength) return head.subarray(start, boundedEnd);
      return object.read(start, boundedEnd);
    },
  };
}

function mpegAudioFrame(bytes: Uint8Array): string[] | null {
  const first = bytes[0];
  const second = bytes[1];
  if (first !== 0xff || second === undefined) return null;
  if ((second & 0xf6) === 0xf0) return ["audio/aac"]; // ADTS: 12-bit sync, layer 00
  const layer = (second >> 1) & 0x03;
  const version = (second >> 3) & 0x03;
  if ((second & 0xe0) === 0xe0 && layer !== 0 && version !== 1) return ["audio/mpeg"];
  return null;
}

function ebmlDocType(head: Uint8Array): string | null {
  const limit = Math.min(head.byteLength - 3, 256);
  for (let index = 4; index < limit; index += 1) {
    if (head[index] !== 0x42 || head[index + 1] !== 0x82) continue;
    const sizeByte = head[index + 2] ?? 0;
    if ((sizeByte & 0x80) === 0) return null;
    const length = sizeByte & 0x7f;
    return ascii(head, index + 3, index + 3 + length).replace(/\0+$/u, "");
  }
  return null;
}

async function classifyZipContainer(reader: RandomAccessObject): Promise<{ mimes: string[]; directory: ZipDirectory | null }> {
  let directory: ZipDirectory;
  try {
    directory = await readZipDirectory(reader);
  } catch (error) {
    if (error instanceof ZipFormatError) return { mimes: [...ZIP_MIMES], directory: null };
    throw error;
  }
  const names = new Set(directory.entries.map((entry) => entry.names[0] ?? ""));
  if (names.has("[Content_Types].xml")) {
    if (names.has("word/document.xml")) return { mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], directory };
    if (names.has("xl/workbook.xml")) return { mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], directory };
    if (names.has("ppt/presentation.xml")) return { mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], directory };
  }
  const first = directory.entries[0];
  if (first && first.names[0] === "mimetype") {
    try {
      const payload = await readStoredEntry(reader, first, 128);
      const declared = payload ? new TextDecoder().decode(payload).trim() : "";
      if (declared.startsWith("application/vnd.oasis.opendocument.")) return { mimes: [declared], directory };
    } catch (error) {
      if (!(error instanceof ZipFormatError)) throw error;
    }
  }
  return { mimes: [...ZIP_MIMES], directory };
}

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const CFB_MAX_REGULAR_SECTOR = 0xfffffffa;
const CFB_HEADER_DIFAT_ENTRIES = 109;

/** Reads the directory stream names of an OLE2 compound file (doc/xls/ppt). */
async function classifyCompoundFile(reader: RandomAccessObject): Promise<string[]> {
  const generic = ["application/x-cfb"];
  const header = await reader.read(0, 512);
  if (header.byteLength < 512) return generic;
  const view = dataView(header);
  const shift = view.getUint16(30, true);
  if (shift !== 9 && shift !== 12) return generic;
  const sectorSize = 1 << shift;
  const perSector = sectorSize / 4;
  const offsetOf = (sector: number): number => (sector + 1) * sectorSize;
  const readUint32 = async (offset: number): Promise<number | null> => {
    const bytes = await reader.read(offset, offset + 4);
    return bytes.byteLength === 4 ? dataView(bytes).getUint32(0, true) : null;
  };
  const fatSectorAt = async (index: number): Promise<number | null> => {
    if (index < CFB_HEADER_DIFAT_ENTRIES) return view.getUint32(76 + index * 4, true);
    let remaining = index - CFB_HEADER_DIFAT_ENTRIES;
    let sector: number | null = view.getUint32(68, true);
    for (let hops = 0; sector !== null && sector <= CFB_MAX_REGULAR_SECTOR && hops < MAX_CFB_DIFAT_SECTORS; hops += 1) {
      if (remaining < perSector - 1) return readUint32(offsetOf(sector) + remaining * 4);
      sector = await readUint32(offsetOf(sector) + (perSector - 1) * 4);
      remaining -= perSector - 1;
    }
    return null;
  };
  const nextSector = async (sector: number): Promise<number | null> => {
    const fatSector = await fatSectorAt(Math.floor(sector / perSector));
    if (fatSector === null || fatSector > CFB_MAX_REGULAR_SECTOR) return null;
    return readUint32(offsetOf(fatSector) + (sector % perSector) * 4);
  };

  const names = new Set<string>();
  let sector: number | null = view.getUint32(48, true);
  for (let visited = 0; sector !== null && sector <= CFB_MAX_REGULAR_SECTOR && visited < MAX_CFB_DIRECTORY_SECTORS; visited += 1) {
    const start = offsetOf(sector);
    const bytes = await reader.read(start, start + sectorSize);
    if (bytes.byteLength !== sectorSize) break;
    const sectorView = dataView(bytes);
    for (let entry = 0; entry + 128 <= bytes.byteLength; entry += 128) {
      const nameLength = sectorView.getUint16(entry + 64, true);
      const objectType = bytes[entry + 66];
      if (objectType === 0 || nameLength < 2 || nameLength > 64) continue;
      names.add(Buffer.from(bytes.subarray(entry, entry + nameLength - 2)).toString("utf16le"));
    }
    sector = await nextSector(sector);
  }
  if (names.has("WordDocument")) return ["application/msword"];
  if (names.has("Workbook") || names.has("Book")) return ["application/vnd.ms-excel"];
  if (names.has("PowerPoint Document")) return ["application/vnd.ms-powerpoint"];
  return generic;
}

interface BinaryDetection {
  mimes: string[];
  zip_directory: ZipDirectory | null;
}

/** Detects a binary signature. Returns null when no known signature matches (text candidates). */
export async function detectBinarySignature(head: Uint8Array, reader: RandomAccessObject): Promise<BinaryDetection | null> {
  const only = (...mimes: string[]): BinaryDetection => ({ mimes, zip_directory: null });
  if (matches(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return only("image/png");
  if (matches(head, [0xff, 0xd8, 0xff])) return only("image/jpeg");
  const gif = ascii(head, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return only("image/gif");
  if (ascii(head, 0, 5) === "%PDF-") return only("application/pdf");
  if (ascii(head, 0, 4) === "RIFF") {
    const form = ascii(head, 8, 12);
    if (form === "WEBP") return only("image/webp");
    if (form === "WAVE") return only("audio/wav");
    if (form === "AVI ") return only("video/x-msvideo");
    return only(OCTET_STREAM);
  }
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "qt  ") return only("video/quicktime");
    if (brand.startsWith("3gp") || brand.startsWith("3g2")) return only("video/3gpp");
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return only("audio/mp4");
    return only("video/mp4", "audio/mp4");
  }
  if (["moov", "mdat", "wide", "pnot"].includes(ascii(head, 4, 8))) return only("video/quicktime");
  if (matches(head, [0x00, 0x00, 0x01, 0xba]) || matches(head, [0x00, 0x00, 0x01, 0xb3])) return only("video/mpeg");
  if (matches(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const docType = ebmlDocType(head);
    if (docType === "webm") return only("video/webm", "audio/webm");
    if (docType === "matroska") return only("video/x-matroska");
    return only(OCTET_STREAM);
  }
  if (ascii(head, 0, 4) === "OggS") {
    // A Theora stream makes it video; otherwise audio (Vorbis/Opus/FLAC) is expected.
    if (includesSequence(head, [0x80, 0x74, 0x68, 0x65, 0x6f, 0x72, 0x61])) return only("video/ogg");
    return only("audio/ogg", "video/ogg");
  }
  if (ascii(head, 0, 3) === "ID3" && head.byteLength >= 10) {
    const tagSize = ((head[6] ?? 0) & 0x7f) * 0x200000 + ((head[7] ?? 0) & 0x7f) * 0x4000
      + ((head[8] ?? 0) & 0x7f) * 0x80 + ((head[9] ?? 0) & 0x7f);
    const frameOffset = 10 + tagSize + (((head[5] ?? 0) & 0x10) !== 0 ? 10 : 0);
    const frame = await reader.read(frameOffset, frameOffset + 4);
    return only(...(mpegAudioFrame(frame) ?? [OCTET_STREAM]));
  }
  const frame = mpegAudioFrame(head);
  if (frame) return only(...frame);
  if (matches(head, [0x50, 0x4b, 0x03, 0x04]) || matches(head, [0x50, 0x4b, 0x05, 0x06])
    || matches(head, [0x50, 0x4b, 0x07, 0x08]) || matches(head, [0x50, 0x4b, 0x30, 0x30])) {
    const container = await classifyZipContainer(reader);
    return { mimes: container.mimes, zip_directory: container.directory };
  }
  if (matches(head, CFB_SIGNATURE)) return only(...await classifyCompoundFile(reader));
  return null;
}

function skipXmlPreamble(text: string): string {
  let rest = text.replace(/^﻿/u, "").trimStart();
  for (let guard = 0; guard < 64; guard += 1) {
    if (rest.startsWith("<?xml")) {
      const end = rest.indexOf("?>");
      if (end < 0) return "";
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end < 0) return "";
      rest = rest.slice(end + 3).trimStart();
    } else if (/^<!doctype/iu.test(rest)) {
      const end = rest.indexOf(">");
      if (end < 0) return "";
      // Doctypes with an internal subset (entities) are left in place and fail the root check.
      if (rest.slice(0, end).includes("[")) return rest;
      rest = rest.slice(end + 1).trimStart();
    } else {
      return rest;
    }
  }
  return rest;
}

export function looksLikeSvg(text: string): boolean {
  return /^<svg[\s>/]/iu.test(skipXmlPreamble(text));
}

export function looksLikeHtml(text: string): boolean {
  let rest = text.replace(/^﻿/u, "").trimStart();
  for (let guard = 0; guard < 64 && rest.startsWith("<!--"); guard += 1) {
    const end = rest.indexOf("-->");
    if (end < 0) return false;
    rest = rest.slice(end + 3).trimStart();
  }
  return /^<!doctype\s+html[\s>]/iu.test(rest) || /^<(html|head|body)[\s>]/iu.test(rest);
}

const ACTIVE_MARKUP_PATTERNS: readonly RegExp[] = [
  /<script[\s>/]/u,
  /<(iframe|frame|frameset|object|embed|applet|base|portal)[\s>/]/u,
  /<foreignobject[\s>/]/u,
  /<!entity/u,
  /<\?xml-stylesheet/u,
  /<meta[^>]*http-equiv\s*=\s*["']?\s*refresh/u,
  /<[^>]*[\s"'/]on[a-z]+\s*=/u,
  /<[^>]*[\s"'/]srcdoc\s*=/u,
];

const ACTIVE_URL_SCHEMES: readonly string[] = [
  "javascript:",
  "vbscript:",
  "livescript:",
  "data:text/html",
  "data:image/svg+xml",
  "data:application/xhtml",
];

function decodeCharacterReferences(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/giu, (_, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d{1,7});?/gu, (_, decimal: string) => String.fromCodePoint(Math.min(Number.parseInt(decimal, 10), 0x10ffff)))
    .replace(/&colon;/giu, ":")
    .replace(/&tab;/giu, "")
    .replace(/&newline;/giu, "");
}

/**
 * True when the SVG/HTML document carries no active content (scripts, event handlers, embedded
 * documents, script URLs, entity declarations). The object itself is never rewritten, because the
 * client-side SHA-256 must stay valid; passivation is therefore enforced as "accept only passive
 * documents" plus attachment delivery of the promoted object.
 */
export function isActiveContentFree(text: string): boolean {
  const lower = text.toLowerCase();
  if (ACTIVE_MARKUP_PATTERNS.some((pattern) => pattern.test(lower))) return false;
  const compact = decodeCharacterReferences(lower).replace(/[\s\u0000-\u001f]+/gu, "");
  return !ACTIVE_URL_SCHEMES.some((scheme) => compact.includes(scheme));
}

interface StreamScan {
  size_bytes: number;
  sha256: string;
  head: Uint8Array;
  utf8_text: boolean;
  text: string | null;
  oversized: boolean;
}

async function streamObject(object: InspectableObject, keepText: boolean): Promise<StreamScan> {
  const hash = createHash("sha256");
  const head = new Uint8Array(INSPECTION_HEAD_BYTES);
  let headLength = 0;
  let size = 0;
  let utf8Text = true;
  let textChunks: Uint8Array[] | null = keepText ? [] : null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = object.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONNECTOR_FILE_SIZE_BYTES) {
        await reader.cancel();
        return { size_bytes: size, sha256: UNINSPECTED_SHA256, head: new Uint8Array(0), utf8_text: false, text: null, oversized: true };
      }
      hash.update(value);
      if (headLength < head.byteLength) {
        const take = Math.min(head.byteLength - headLength, value.byteLength);
        head.set(value.subarray(0, take), headLength);
        headLength += take;
      }
      if (utf8Text) {
        if (value.includes(0)) {
          utf8Text = false;
        } else {
          try {
            decoder.decode(value, { stream: true });
          } catch {
            utf8Text = false;
          }
        }
      }
      if (textChunks) {
        if (size > MAX_TEXT_DOCUMENT_BYTES) textChunks = null;
        else textChunks.push(value.slice());
      }
    }
    if (utf8Text) {
      try {
        decoder.decode();
      } catch {
        utf8Text = false;
      }
    }
  } finally {
    reader.releaseLock();
  }

  let text: string | null = null;
  if (utf8Text && textChunks) {
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of textChunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
  }
  return {
    size_bytes: size,
    sha256: hash.digest("hex"),
    head: head.subarray(0, headLength),
    utf8_text: utf8Text,
    text,
    oversized: false,
  };
}

function classifyText(declared: ConnectorUploadMime, scan: StreamScan): { detected: string; magic: boolean } {
  if (!scan.utf8_text) return { detected: OCTET_STREAM, magic: false };
  if (declared === "application/json") {
    if (scan.text === null) return { detected: "text/plain", magic: true };
    try {
      JSON.parse(scan.text);
      return { detected: "application/json", magic: true };
    } catch {
      return { detected: "text/plain", magic: true };
    }
  }
  if (declared === "image/svg+xml" && scan.text !== null && looksLikeSvg(scan.text)) return { detected: declared, magic: true };
  if (declared === "text/html" && scan.text !== null && looksLikeHtml(scan.text)) return { detected: declared, magic: true };
  return { detected: "text/plain", magic: true };
}

/** Full inspection of one stored object: one streaming pass plus bounded ranged reads. */
export async function inspectStoredObject(input: {
  object: InspectableObject;
  declared_filename: string;
  declared_mime_type: ConnectorUploadMime;
}): Promise<StoredObjectInspection> {
  const declared = input.declared_mime_type;
  const extensionMatch = extensionMatches(input.declared_filename, declared);
  const oversized = (size: number): StoredObjectInspection => ({
    size_bytes: size,
    sha256: UNINSPECTED_SHA256,
    detected_mime_type: OCTET_STREAM,
    magic_bytes_match: false,
    extension_match: extensionMatch,
    active_content_passivated: false,
    zip: null,
  });
  if (input.object.size > MAX_CONNECTOR_FILE_SIZE_BYTES) return oversized(input.object.size);

  const keepText = TEXT_DOCUMENT_MIMES.has(declared) && input.object.size <= MAX_TEXT_DOCUMENT_BYTES;
  const scan = await streamObject(input.object, keepText);
  if (scan.oversized) return oversized(scan.size_bytes);

  const reader = headCachedReader(input.object, scan.head, scan.size_bytes);
  const binary = await detectBinarySignature(scan.head, reader);
  let detected: string;
  let magic: boolean;
  let zip: ZipInspection | null = null;
  if (binary) {
    detected = binary.mimes.includes(declared) ? declared : binary.mimes[0] ?? OCTET_STREAM;
    magic = detected !== OCTET_STREAM;
    if (ZIP_MIMES.includes(detected) && binary.zip_directory) zip = inspectZipDirectory(binary.zip_directory);
  } else {
    ({ detected, magic } = classifyText(declared, scan));
  }

  const needsPassivation = ACTIVE_CONTENT_MIMES.has(declared) || ACTIVE_CONTENT_MIMES.has(detected);
  return {
    size_bytes: scan.size_bytes,
    sha256: scan.sha256,
    detected_mime_type: detected,
    magic_bytes_match: magic,
    extension_match: extensionMatch,
    active_content_passivated: needsPassivation ? scan.text !== null && isActiveContentFree(scan.text) : true,
    zip,
  };
}
