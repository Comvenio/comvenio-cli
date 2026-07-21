import type { ConnectionOptions } from "bullmq";

import type {
  AsyncJobHandle,
  ConnectorErrorCode,
  FairUseBucket,
  RateLimitConfig,
  RequestContext,
  UUID,
} from "@comvenio/connector-contracts";

export const COMVENIO_JOB_QUEUE_NAME = "comvenio-mcp-jobs-v1";
export const JOB_METADATA_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface InternalJobRecord {
  handle: AsyncJobHandle;
  request_id: UUID;
  oauth_grant_id: UUID;
  capability_version: string;
  operation_reference: UUID;
  idempotency_key: UUID;
  fair_use_bucket: "import_export" | "heavy_job";
  heavy_slot_key: string | null;
  cancellable: boolean;
}

export interface JobQueuePort {
  get(jobId: UUID): Promise<InternalJobRecord | null>;
  enqueue(record: InternalJobRecord): Promise<InternalJobRecord>;
  cancel(jobId: UUID, now: string): Promise<InternalJobRecord | null>;
  readiness(): Promise<boolean>;
  close(): Promise<void>;
}

export interface JobAuthorizationPort {
  reauthorize(input: {
    context: RequestContext;
    tool_name: string;
    action: "start" | "status" | "cancel";
  }): Promise<{ capability_version: string }>;
}

export interface JobStartRequest {
  context: RequestContext;
  club_id: UUID;
  tool_name: string;
  operation_reference: UUID;
  idempotency_key: UUID;
  fair_use_bucket: "import_export" | "heavy_job";
  cancellable: boolean;
}

export interface FairUseDimensions {
  ip?: string;
  subject_id?: UUID;
  club_id?: UUID;
}

export interface FairUseDecision {
  allowed: boolean;
  retry_after_seconds: number;
}

export interface FairUseStore {
  consume(input: {
    key: string;
    limit: number;
    window_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision>;
  acquireHeavy(input: {
    key: string;
    job_id: UUID;
    limit: number;
    ttl_seconds: number;
    now_epoch_seconds: number;
  }): Promise<FairUseDecision>;
  releaseHeavy(input: { key: string; job_id: UUID }): Promise<void>;
}

export interface FairUseCheck {
  bucket: FairUseBucket;
  dimensions: FairUseDimensions;
  request_id: UUID;
}

export interface JobClock { now(): Date; }

export interface BullMqJobQueueOptions {
  connection: ConnectionOptions;
  prefix?: string;
}

export interface JobProcessorResult {
  result_file_id: UUID | null;
  error_code: ConnectorErrorCode | null;
}

export interface JobProcessorPort {
  process(input: {
    record: InternalJobRecord;
    signal?: AbortSignal;
    reportProgress(percent: number): Promise<void>;
  }): Promise<JobProcessorResult>;
}

export interface RateLimitConfigSource {
  load(): unknown | Promise<unknown>;
}

export interface LoadedFairUseConfig {
  config: RateLimitConfig;
  source: string;
}
