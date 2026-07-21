import {
  MAX_ZIP_COMPRESSION_RATIO,
  MAX_ZIP_DIRECTORY_DEPTH,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_PATH_LENGTH,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  type ConnectorUploadMime,
  type UploadRejectionCode,
} from "@comvenio/connector-contracts";

import type { StoredObjectInspection, ZipInspection } from "./types.ts";

const ZIP_MIMES = new Set<ConnectorUploadMime>([
  "application/zip",
  "application/x-zip-compressed",
]);

function zipRejection(zip: ZipInspection): UploadRejectionCode | null {
  if (zip.has_absolute_path
    || zip.has_parent_traversal
    || zip.has_symlink
    || zip.has_hardlink
    || zip.has_device_entry
    || zip.is_encrypted
    || zip.is_multi_disk
    || zip.has_nested_archive) return "UNSAFE_ARCHIVE";
  if (zip.entry_count > MAX_ZIP_ENTRIES
    || zip.total_uncompressed_bytes > MAX_ZIP_UNCOMPRESSED_BYTES
    || zip.largest_entry_bytes > MAX_ZIP_ENTRY_BYTES
    || zip.maximum_compression_ratio > MAX_ZIP_COMPRESSION_RATIO
    || zip.maximum_directory_depth > MAX_ZIP_DIRECTORY_DEPTH
    || zip.maximum_normalized_path_length > MAX_ZIP_PATH_LENGTH) return "ARCHIVE_LIMIT_EXCEEDED";
  return null;
}

export function validateStoredObject(input: {
  inspection: StoredObjectInspection;
  declared_mime_type: ConnectorUploadMime;
  declared_size_bytes: number;
  completion_size_bytes: number;
  completion_sha256: string;
}): UploadRejectionCode | null {
  const { inspection } = input;
  if (inspection.size_bytes !== input.declared_size_bytes || inspection.size_bytes !== input.completion_size_bytes) {
    return "SIZE_MISMATCH";
  }
  if (inspection.sha256 !== input.completion_sha256) return "HASH_MISMATCH";
  if (inspection.detected_mime_type !== input.declared_mime_type
    || !inspection.magic_bytes_match
    || !inspection.extension_match) return "MIME_MISMATCH";
  if (["image/svg+xml", "text/html"].includes(input.declared_mime_type) && !inspection.active_content_passivated) {
    return "MIME_MISMATCH";
  }
  if (ZIP_MIMES.has(input.declared_mime_type)) {
    return inspection.zip ? zipRejection(inspection.zip) : "UNSAFE_ARCHIVE";
  }
  return inspection.zip ? "MIME_MISMATCH" : null;
}
