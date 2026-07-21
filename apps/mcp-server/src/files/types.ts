import type {
  ConnectorFileReference,
  ConnectorUploadMime,
  RequestContext,
  UploadCompleteRequest,
  UploadHandle,
  UploadPurpose,
  UUID,
} from "@comvenio/connector-contracts";

export interface ZipInspection {
  entry_count: number;
  total_uncompressed_bytes: number;
  largest_entry_bytes: number;
  maximum_compression_ratio: number;
  maximum_directory_depth: number;
  maximum_normalized_path_length: number;
  has_absolute_path: boolean;
  has_parent_traversal: boolean;
  has_symlink: boolean;
  has_hardlink: boolean;
  has_device_entry: boolean;
  is_encrypted: boolean;
  is_multi_disk: boolean;
  has_nested_archive: boolean;
}

export interface StoredObjectInspection {
  size_bytes: number;
  sha256: string;
  detected_mime_type: string;
  magic_bytes_match: boolean;
  extension_match: boolean;
  active_content_passivated: boolean;
  zip: ZipInspection | null;
}

export interface InternalUploadRecord {
  handle: UploadHandle;
  oauth_grant_id: UUID;
  owner_subject_id: UUID;
  capability_version: string;
  filename: string | null;
  mime_type: ConnectorUploadMime | null;
  size_bytes: number | null;
  purpose: UploadPurpose | null;
  object_key: string | null;
  staged_file_id: UUID | null;
  rejection_sha256: string | null;
  created_at: string;
}

export interface InternalConnectorFileRecord {
  file_id: UUID;
  upload_id: UUID | null;
  oauth_grant_id: UUID;
  owner_subject_id: UUID;
  club_id: UUID;
  capability_version: string;
  name: string;
  mime_type: ConnectorUploadMime;
  size_bytes: number;
  sha256: string;
  purpose: UploadPurpose | "job_result";
  object_key: string;
  state: "clean" | "consumed" | "expired";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface FileMetadataStore {
  createUpload(record: InternalUploadRecord): Promise<void>;
  getUpload(uploadId: UUID): Promise<InternalUploadRecord | null>;
  updateUpload(record: InternalUploadRecord): Promise<void>;
  createFile(record: InternalConnectorFileRecord): Promise<void>;
  finalizeUpload(input: {
    upload: InternalUploadRecord;
    file: InternalConnectorFileRecord;
  }): Promise<void>;
  getFile(fileId: UUID): Promise<InternalConnectorFileRecord | null>;
  consumeFile(input: {
    file_id: UUID;
    upload_id: UUID;
    subject_id: UUID;
    oauth_grant_id: UUID;
    club_id: UUID;
    now: string;
  }): Promise<InternalConnectorFileRecord | null>;
}

export interface QuarantineObjectPort {
  createPresignedUpload(input: {
    object_key: string;
    mime_type: ConnectorUploadMime;
    size_bytes: number;
    expires_in_seconds: number;
  }): Promise<{ url: string }>;
  inspect(input: { object_key: string; declared_filename: string; declared_mime_type: ConnectorUploadMime }): Promise<StoredObjectInspection>;
  delete(input: { object_key: string }): Promise<void>;
  promoteClean(input: { quarantine_object_key: string; file_id: UUID }): Promise<{ object_key: string }>;
  createPresignedDownload(input: { object_key: string; expires_in_seconds: number }): Promise<{ url: string; expires_at: string }>;
}

export interface MalwareScannerPort {
  scan(input: { object_key: string }): Promise<"clean" | "infected" | "unavailable">;
}

export interface FileAuthorizationPort {
  reauthorize(input: {
    context: RequestContext;
    action: "upload_start" | "upload_complete" | "file_get" | "file_consume";
    purpose?: UploadPurpose | "job_result";
  }): Promise<{ capability_version: string }>;
}

export interface FileClock { now(): Date; }
export interface FileRandom { uuid(): UUID; }

export interface FileUploadCompleteInput {
  context: RequestContext;
  club_id: UUID;
  upload_id: UUID;
  completion: UploadCompleteRequest;
}

export interface FileGetInput {
  context: RequestContext;
  club_id: UUID;
  file_id: UUID;
}

export interface FileConsumeInput {
  context: RequestContext;
  club_id: UUID;
  upload_id: UUID;
  file_id: UUID;
}

export interface SafeFileResult {
  handle: UploadHandle;
  reference: ConnectorFileReference | null;
}
