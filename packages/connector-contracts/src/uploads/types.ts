import type { UUID } from "../index.ts";

export const CONNECTOR_UPLOAD_MIME_VALUES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "video/mp4",
  "video/mpeg",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/3gpp",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/aac",
] as const;

export type ConnectorUploadMime = (typeof CONNECTOR_UPLOAD_MIME_VALUES)[number];
export type UploadState =
  | "pending"
  | "uploaded"
  | "scanning"
  | "clean"
  | "rejected"
  | "consumed"
  | "expired";

export type UploadPurpose = "domain_import" | "event_asset" | "news_asset" | "club_file";
export type UploadRejectionCode =
  | "MIME_MISMATCH"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  | "MALWARE"
  | "ARCHIVE_LIMIT_EXCEEDED"
  | "UNSAFE_ARCHIVE"
  | "EXPIRED";

export interface ConnectorFileReference {
  file_id: UUID;
  club_id: UUID;
  name: string;
  mime_type: ConnectorUploadMime;
  size_bytes: number;
  sha256: string;
  download_url: string;
  expires_at: string;
}

export interface UploadCreateRequest {
  club_id: UUID;
  filename: string;
  mime_type: ConnectorUploadMime;
  size_bytes: number;
  purpose: UploadPurpose;
}

export interface UploadHandle {
  upload_id: UUID;
  club_id: UUID;
  owner_subject_id: UUID;
  upload_url: string | null;
  required_headers: { "Content-Type": ConnectorUploadMime } | null;
  state: UploadState;
  expires_at: string;
  file_id: UUID | null;
  rejection_code: UploadRejectionCode | null;
}

export interface UploadCompleteRequest {
  size_bytes: number;
  sha256: string;
}

export interface FileUploadStartTool {
  tool_name: "cv_file_upload_start_write";
  input: UploadCreateRequest;
  output: UploadHandle;
}

export interface FileUploadCompleteTool {
  tool_name: "cv_file_upload_complete_write";
  input: { club_id: UUID; upload_id: UUID; completion: UploadCompleteRequest };
  output: UploadHandle;
}

export interface FileGetTool {
  tool_name: "cv_file_get_read";
  input: { club_id: UUID; file_id: UUID };
  output: ConnectorFileReference;
}
