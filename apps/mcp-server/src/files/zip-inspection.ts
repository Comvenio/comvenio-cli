import {
  MAX_ZIP_COMPRESSION_RATIO,
  MAX_ZIP_DIRECTORY_DEPTH,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_PATH_LENGTH,
  MAX_ZIP_UNCOMPRESSED_BYTES,
} from "@comvenio/connector-contracts";

import type { ZipInspection } from "./types.ts";

// Reads only the central directory (and at most one local header for container detection).
// Nothing is decompressed and nothing is written to disk.

export const MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const SPANNING_SIGNATURE = 0x08074b50;
const SPANNING_TEMPORARY_SIGNATURE = 0x30304b50;
const EOCD_BYTES = 22;
const MAX_EOCD_COMMENT_BYTES = 0xffff;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_EOCD_BYTES = 56;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
const UNIX_DEVICE_TYPES = new Set([0o020000, 0o060000, 0o010000, 0o140000]);

const NESTED_ARCHIVE_EXTENSIONS = new Set([
  "zip", "zipx", "jar", "war", "ear", "apk", "7z", "rar", "tar", "gz", "tgz", "bz2", "tbz", "tbz2",
  "xz", "txz", "zst", "lz", "lzma", "lzh", "lha", "z", "cab", "iso", "dmg", "arj", "cpio", "rpm", "deb",
]);

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

export interface RandomAccessObject {
  size: number;
  /** Returns the bytes in [start, end). */
  read(start: number, end: number): Promise<Uint8Array>;
}

export interface ZipDirectoryEntry {
  names: string[];
  flags: number;
  method: number;
  compressed_size: number;
  uncompressed_size: number;
  disk_start: number;
  external_attributes: number;
  local_header_offset: number;
  has_unix_link_data: boolean;
  has_aes_extra: boolean;
}

export interface ZipDirectory {
  declared_entry_count: number;
  is_multi_disk: boolean;
  entries: ZipDirectoryEntry[];
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function safeUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError("ZIP64 value exceeds the safe range.");
  return Number(value);
}

async function readExact(object: RandomAccessObject, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end > object.size || start > end) throw new ZipFormatError("ZIP structure points outside the object.");
  const bytes = await object.read(start, end);
  if (bytes.byteLength !== end - start) throw new ZipFormatError("Short read on a ZIP structure.");
  return bytes;
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  if (!utf8) {
    // CP437 fallback: every byte stays one code point; path separators and dots are ASCII.
    let result = "";
    for (const byte of raw) result += String.fromCharCode(byte);
    return result;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new ZipFormatError("ZIP entry name is not valid UTF-8.");
  }
}

/** Parses the end-of-central-directory records and the central directory. Fail-closed on any inconsistency. */
export async function readZipDirectory(object: RandomAccessObject): Promise<ZipDirectory> {
  if (object.size < EOCD_BYTES) throw new ZipFormatError("Object is too small for a ZIP archive.");
  const prefix = dataView(await readExact(object, 0, 4)).getUint32(0, true);
  const spanned = prefix === SPANNING_SIGNATURE || prefix === SPANNING_TEMPORARY_SIGNATURE;

  const tailStart = Math.max(0, object.size - (EOCD_BYTES + MAX_EOCD_COMMENT_BYTES));
  const tail = await readExact(object, tailStart, object.size);
  const tailView = dataView(tail);
  let eocd = -1;
  for (let index = tail.byteLength - EOCD_BYTES; index >= 0; index -= 1) {
    if (tailView.getUint32(index, true) === EOCD_SIGNATURE
      && index + EOCD_BYTES + tailView.getUint16(index + 20, true) === tail.byteLength) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("End of central directory not found.");

  let disk = tailView.getUint16(eocd + 4, true);
  let directoryDisk = tailView.getUint16(eocd + 6, true);
  let entriesOnDisk = tailView.getUint16(eocd + 8, true);
  let totalEntries = tailView.getUint16(eocd + 10, true);
  let directorySize = tailView.getUint32(eocd + 12, true);
  let directoryOffset = tailView.getUint32(eocd + 16, true);
  let directoryEnd = tailStart + eocd;
  let totalDisks = 1;
  const needsZip64 = disk === 0xffff || directoryDisk === 0xffff || entriesOnDisk === 0xffff
    || totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff;

  if (eocd >= ZIP64_LOCATOR_BYTES && tailView.getUint32(eocd - ZIP64_LOCATOR_BYTES, true) === ZIP64_LOCATOR_SIGNATURE) {
    const locator = eocd - ZIP64_LOCATOR_BYTES;
    const locatorDisk = tailView.getUint32(locator + 4, true);
    const recordOffset = safeUint64(tailView, locator + 8);
    totalDisks = Math.max(tailView.getUint32(locator + 16, true), locatorDisk + 1);
    const record = dataView(await readExact(object, recordOffset, recordOffset + ZIP64_EOCD_BYTES));
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new ZipFormatError("ZIP64 end of central directory not found.");
    disk = record.getUint32(16, true);
    directoryDisk = record.getUint32(20, true);
    entriesOnDisk = safeUint64(record, 24);
    totalEntries = safeUint64(record, 32);
    directorySize = safeUint64(record, 40);
    directoryOffset = safeUint64(record, 48);
    directoryEnd = recordOffset;
  } else if (needsZip64) {
    throw new ZipFormatError("ZIP64 values without a ZIP64 locator.");
  }

  const isMultiDisk = spanned || disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== totalEntries || totalDisks > 1;
  // Fail-closed shortcut: the inspection ends at the first limit breach (G.3), no need to read further.
  if (isMultiDisk || totalEntries > MAX_ZIP_ENTRIES) {
    return { declared_entry_count: totalEntries, is_multi_disk: isMultiDisk, entries: [] };
  }
  if (directorySize > MAX_ZIP_CENTRAL_DIRECTORY_BYTES) throw new ZipFormatError("Central directory exceeds the inspection limit.");
  if (directoryOffset + directorySize > directoryEnd) throw new ZipFormatError("Central directory overlaps the end records.");

  const directory = await readExact(object, directoryOffset, directoryOffset + directorySize);
  const view = dataView(directory);
  const entries: ZipDirectoryEntry[] = [];
  let offset = 0;
  while (entries.length < totalEntries) {
    if (offset + CENTRAL_HEADER_BYTES > directory.byteLength) throw new ZipFormatError("Truncated central directory.");
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) throw new ZipFormatError("Invalid central directory header.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let diskStart = view.getUint16(offset + 34, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    let localHeaderOffset = view.getUint32(offset + 42, true);
    const nameEnd = offset + CENTRAL_HEADER_BYTES + nameLength;
    const extraEnd = nameEnd + extraLength;
    const next = extraEnd + commentLength;
    if (next > directory.byteLength) throw new ZipFormatError("Truncated central directory entry.");

    const names = [decodeName(directory.subarray(offset + CENTRAL_HEADER_BYTES, nameEnd), (flags & 0x0800) !== 0)];
    let hasUnixLinkData = false;
    let hasAesExtra = false;
    let extra = nameEnd;
    while (extra < extraEnd) {
      if (extra + 4 > extraEnd) throw new ZipFormatError("Truncated extra field.");
      const id = view.getUint16(extra, true);
      const size = view.getUint16(extra + 2, true);
      const dataStart = extra + 4;
      const dataEnd = dataStart + size;
      if (dataEnd > extraEnd) throw new ZipFormatError("Extra field exceeds its entry.");
      if (id === 0x0001) {
        let cursor = dataStart;
        const take64 = (): number => {
          if (cursor + 8 > dataEnd) throw new ZipFormatError("Truncated ZIP64 extra field.");
          const value = safeUint64(view, cursor);
          cursor += 8;
          return value;
        };
        if (uncompressedSize === 0xffffffff) uncompressedSize = take64();
        if (compressedSize === 0xffffffff) compressedSize = take64();
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = take64();
        if (diskStart === 0xffff) {
          if (cursor + 4 > dataEnd) throw new ZipFormatError("Truncated ZIP64 extra field.");
          diskStart = view.getUint32(cursor, true);
        }
      } else if (id === 0x7075 && size >= 5) {
        // Info-ZIP Unicode path: an alternative name some extractors prefer, so it is checked as well.
        names.push(decodeName(directory.subarray(dataStart + 5, dataEnd), true));
      } else if (id === 0x000d && size > 12) {
        // PKWARE Unix extra field: variable data carries a link target (symlink or hardlink).
        hasUnixLinkData = true;
      } else if (id === 0x9901) {
        hasAesExtra = true;
      }
      extra = dataEnd;
    }

    entries.push({
      names,
      flags,
      method,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      disk_start: diskStart,
      external_attributes: externalAttributes,
      local_header_offset: localHeaderOffset,
      has_unix_link_data: hasUnixLinkData,
      has_aes_extra: hasAesExtra,
    });
    offset = next;
  }
  // Undeclared trailing entries are a known technique to hide content from some parsers.
  if (offset !== directory.byteLength) throw new ZipFormatError("Central directory contains undeclared data.");
  return { declared_entry_count: totalEntries, is_multi_disk: false, entries };
}

/** Reads the stored (uncompressed) payload of one entry, bounded by maxBytes. Returns null if not applicable. */
export async function readStoredEntry(object: RandomAccessObject, entry: ZipDirectoryEntry, maxBytes: number): Promise<Uint8Array | null> {
  if (entry.method !== 0 || entry.compressed_size > maxBytes) return null;
  const header = dataView(await readExact(object, entry.local_header_offset, entry.local_header_offset + LOCAL_HEADER_BYTES));
  if (header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) throw new ZipFormatError("Invalid local file header.");
  const dataStart = entry.local_header_offset + LOCAL_HEADER_BYTES + header.getUint16(26, true) + header.getUint16(28, true);
  return readExact(object, dataStart, dataStart + entry.compressed_size);
}

interface PathFacts {
  absolute: boolean;
  traversal: boolean;
  depth: number;
  length: number;
  nested: boolean;
}

function analyzePath(raw: string, isDirectory: boolean): PathFacts {
  if (raw.includes("\0")) throw new ZipFormatError("ZIP entry name contains NUL.");
  const unified = raw.normalize("NFC").replaceAll("\\", "/");
  const absolute = unified.startsWith("/") || /^[a-zA-Z]:/u.test(unified);
  const segments = unified.split("/").filter((segment) => segment !== "" && segment !== ".");
  const normalized = segments.join("/");
  const last = segments.at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  const extension = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  return {
    absolute,
    traversal: segments.includes(".."),
    depth: isDirectory ? segments.length : Math.max(segments.length - 1, 0),
    length: [...normalized].length,
    nested: !isDirectory && NESTED_ARCHIVE_EXTENSIONS.has(extension),
  };
}

function emptyInspection(entryCount: number, multiDisk: boolean): ZipInspection {
  return {
    entry_count: entryCount,
    total_uncompressed_bytes: 0,
    largest_entry_bytes: 0,
    maximum_compression_ratio: 0,
    maximum_directory_depth: 0,
    maximum_normalized_path_length: 0,
    has_absolute_path: false,
    has_parent_traversal: false,
    has_symlink: false,
    has_hardlink: false,
    has_device_entry: false,
    is_encrypted: false,
    is_multi_disk: multiDisk,
    has_nested_archive: false,
  };
}

function limitBreached(zip: ZipInspection): boolean {
  return zip.has_absolute_path || zip.has_parent_traversal || zip.has_symlink || zip.has_hardlink
    || zip.has_device_entry || zip.is_encrypted || zip.is_multi_disk || zip.has_nested_archive
    || zip.entry_count > MAX_ZIP_ENTRIES
    || zip.total_uncompressed_bytes > MAX_ZIP_UNCOMPRESSED_BYTES
    || zip.largest_entry_bytes > MAX_ZIP_ENTRY_BYTES
    || zip.maximum_compression_ratio > MAX_ZIP_COMPRESSION_RATIO
    || zip.maximum_directory_depth > MAX_ZIP_DIRECTORY_DEPTH
    || zip.maximum_normalized_path_length > MAX_ZIP_PATH_LENGTH;
}

/**
 * Builds the ZipInspection from a parsed directory. The walk stops at the first limit breach (G.3);
 * values reported at that point are partial but always exceed the limit that ended the walk.
 */
export function inspectZipDirectory(directory: ZipDirectory): ZipInspection {
  const zip = emptyInspection(directory.declared_entry_count, directory.is_multi_disk);
  if (limitBreached(zip)) return zip;
  const localOffsets = new Set<number>();
  for (const entry of directory.entries) {
    const primary = entry.names[0] ?? "";
    const isDirectory = primary.endsWith("/") || primary.endsWith("\\");
    for (const name of entry.names) {
      const facts = analyzePath(name, isDirectory);
      zip.has_absolute_path ||= facts.absolute;
      zip.has_parent_traversal ||= facts.traversal;
      zip.has_nested_archive ||= facts.nested;
      zip.maximum_directory_depth = Math.max(zip.maximum_directory_depth, facts.depth);
      zip.maximum_normalized_path_length = Math.max(zip.maximum_normalized_path_length, facts.length);
    }
    const fileType = (entry.external_attributes >>> 16) & UNIX_FILE_TYPE_MASK;
    zip.has_symlink ||= fileType === UNIX_SYMLINK;
    zip.has_device_entry ||= UNIX_DEVICE_TYPES.has(fileType);
    // ZIP has no native hardlink; link data outside a symlink and two names sharing one local header
    // (aliased entries) are treated as hardlinks.
    zip.has_hardlink ||= (entry.has_unix_link_data && fileType !== UNIX_SYMLINK) || localOffsets.has(entry.local_header_offset);
    localOffsets.add(entry.local_header_offset);
    zip.is_encrypted ||= (entry.flags & 0x0001) !== 0 || (entry.flags & 0x0040) !== 0 || entry.method === 99 || entry.has_aes_extra;
    zip.is_multi_disk ||= entry.disk_start !== 0;
    zip.total_uncompressed_bytes += entry.uncompressed_size;
    zip.largest_entry_bytes = Math.max(zip.largest_entry_bytes, entry.uncompressed_size);
    if (entry.uncompressed_size > 0) {
      zip.maximum_compression_ratio = Math.max(
        zip.maximum_compression_ratio,
        entry.uncompressed_size / Math.max(entry.compressed_size, 1),
      );
    }
    if (limitBreached(zip)) return zip;
  }
  return zip;
}
