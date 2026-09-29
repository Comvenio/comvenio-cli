import type {
  ConnectorFileReference,
  ConnectorUploadMime,
  RequestContext,
  UploadCompleteRequest,
  UploadHandle,
  UploadPurpose,
  UploadRequiredHeaders,
  UploadState,
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
  /**
   * Owner of the running completion (state `scanning`). Only the completion holding this id may
   * finish, reject or reopen the upload; absent on records written before it existed.
   */
  completion_id?: UUID | null;
  completion_started_at?: string | null;
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
  /** Inspection whose local copy was promoted to object_key; null for job results. */
  inspection_id?: UUID | null;
  state: "clean" | "consumed" | "expired";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface FileMetadataStore {
  createUpload(record: InternalUploadRecord): Promise<void>;
  getUpload(uploadId: UUID): Promise<InternalUploadRecord | null>;
  updateUpload(record: InternalUploadRecord): Promise<void>;
  /**
   * Compare-and-set: replaces the upload only if its current state and completion_id still equal
   * `expected`. Returns false if another completion changed it in between (or it is gone).
   */
  compareAndSetUpload(input: {
    expected: UploadCompletionGuard;
    record: InternalUploadRecord;
  }): Promise<boolean>;
  createFile(record: InternalConnectorFileRecord): Promise<void>;
  /** Stores upload and file atomically, only while the upload is still held by `expected`. */
  finalizeUpload(input: {
    expected: UploadCompletionGuard;
    upload: InternalUploadRecord;
    file: InternalConnectorFileRecord;
  }): Promise<boolean>;
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

/** Expected upload state and completion owner for a compare-and-set on the upload record. */
export interface UploadCompletionGuard {
  state: UploadState;
  completion_id: UUID | null;
}

/** An inspection of one private local copy, addressed only by its inspection_id. */
export interface ObjectInspectionResult extends StoredObjectInspection {
  inspection_id: UUID;
}

export interface QuarantineObjectPort {
  /**
   * One-time PUT URL signed for exactly the declared size and type and for
   * `If-None-Match: *` (the object can be created at most once); the returned
   * headers are the signed ones the client must send unchanged.
   */
  createPresignedUpload(input: {
    object_key: string;
    mime_type: ConnectorUploadMime;
    size_bytes: number;
    expires_in_seconds: number;
  }): Promise<{ url: string; required_headers: UploadRequiredHeaders }>;
  /**
   * Reads the quarantined object exactly once into a new private local copy and inspects that
   * copy. Every call yields a new, unique inspection_id; the malware scan, the promotion and
   * release() address exactly this copy through it, never through the object key.
   */
  inspect(input: { object_key: string; declared_filename: string; declared_mime_type: ConnectorUploadMime }): Promise<ObjectInspectionResult>;
  /** Drops the local copy of this one inspection; safe to call repeatedly. Other inspections stay. */
  release(input: { inspection_id: UUID }): Promise<void>;
  delete(input: { object_key: string }): Promise<void>;
  /**
   * Copies the local copy of this inspection to the clean area. Returns the hash and size of the
   * bytes written, which equal the inspection's (the copy is re-verified while writing).
   */
  promoteClean(input: { inspection_id: UUID; file_id: UUID }): Promise<{ object_key: string; inspection_id: UUID; sha256: string; size_bytes: number }>;
  createPresignedDownload(input: { object_key: string; expires_in_seconds: number }): Promise<{ url: string; expires_at: string }>;
}

export interface MalwareScannerPort {
  /** Scans exactly the local copy of this inspection. */
  scan(input: { inspection_id: UUID }): Promise<"clean" | "infected" | "unavailable">;
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
