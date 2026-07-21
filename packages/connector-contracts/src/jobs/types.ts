import type { ConnectorError, UUID } from "../index.ts";

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface AsyncJobHandle {
  job_id: UUID;
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  state: JobState;
  progress_percent: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
  result_file_id: UUID | null;
  error_code: ConnectorError["code"] | null;
}

export interface JobStatusTool {
  tool_name: "cv_job_status_read";
  input: { club_id: UUID; job_id: UUID };
  output: AsyncJobHandle;
}

export interface JobCancelTool {
  tool_name: "cv_job_cancel_write";
  input: { club_id: UUID; job_id: UUID };
  output: AsyncJobHandle;
}

export type FairUseBucket =
  | "public_read"
  | "private_read"
  | "reversible_write"
  | "critical_flow"
  | "import_export"
  | "heavy_job";

export type FairUseKeyDimension = "ip" | "subject_id" | "club_id";

export interface FairUsePolicy {
  bucket: FairUseBucket;
  limit: number;
  window_seconds: number;
  key_dimensions: FairUseKeyDimension[];
}

export interface RateLimitConfig {
  contract_version: "1.0.0";
  policies: FairUsePolicy[];
  max_concurrent_heavy_jobs_per_subject_club: 1;
  polling_seconds: [1, 2, 4, 8, 15];
  polling_jitter_percent: 20;
}

export interface RetryAfterError extends ConnectorError {
  code: "RATE_LIMITED";
  retryable: true;
  retry_after_seconds: number;
}
