import { z } from "zod";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const toolName = z.string().trim().min(1).max(200).regex(/^[a-z0-9_.:-]+$/u);
const connectorErrorCode = z.enum([
  "CONFIG_INVALID",
  "AUTH_REQUIRED",
  "AUTH_TEMPORARILY_UNAVAILABLE",
  "SCOPE_REQUIRED",
  "CLUB_SELECTION_REQUIRED",
  "PERMISSION_DENIED",
  "TENANT_MISMATCH",
  "VALIDATION_FAILED",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_EXPIRED",
  "CONFIRMATION_MISMATCH",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  "NOT_FOUND",
]);

export const JOB_STATE_SCHEMA = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

export const ASYNC_JOB_HANDLE_SCHEMA = z.object({
  job_id: uuid,
  subject_id: uuid,
  club_id: uuid,
  tool_name: toolName,
  state: JOB_STATE_SCHEMA,
  progress_percent: z.number().int().min(0).max(100).nullable(),
  created_at: instant,
  started_at: instant.nullable(),
  finished_at: instant.nullable(),
  expires_at: instant,
  result_file_id: uuid.nullable(),
  error_code: connectorErrorCode.nullable(),
}).strict();

export const JOB_STATUS_INPUT_SCHEMA = z.object({ club_id: uuid, job_id: uuid }).strict();
export const JOB_CANCEL_INPUT_SCHEMA = JOB_STATUS_INPUT_SCHEMA;

export const FAIR_USE_BUCKET_SCHEMA = z.enum([
  "public_read",
  "private_read",
  "reversible_write",
  "critical_flow",
  "import_export",
  "heavy_job",
]);

export const FAIR_USE_POLICY_SCHEMA = z.object({
  bucket: FAIR_USE_BUCKET_SCHEMA,
  limit: z.number().int().positive().max(100_000),
  window_seconds: z.number().int().positive().max(86_400),
  key_dimensions: z.array(z.enum(["ip", "subject_id", "club_id"])).min(1).max(3),
}).strict().refine((policy) => new Set(policy.key_dimensions).size === policy.key_dimensions.length, {
  message: "Fair-Use-Schlüsseldimensionen dürfen nicht doppelt vorkommen.",
});

export const RATE_LIMIT_CONFIG_SCHEMA = z.object({
  contract_version: z.literal("1.0.0"),
  policies: z.array(FAIR_USE_POLICY_SCHEMA).length(6),
  max_concurrent_heavy_jobs_per_subject_club: z.literal(1),
  polling_seconds: z.tuple([
    z.literal(1),
    z.literal(2),
    z.literal(4),
    z.literal(8),
    z.literal(15),
  ]),
  polling_jitter_percent: z.literal(20),
}).strict().superRefine((config, context) => {
  const expected = new Set(FAIR_USE_BUCKET_SCHEMA.options);
  for (const policy of config.policies) expected.delete(policy.bucket);
  if (expected.size > 0 || new Set(config.policies.map((policy) => policy.bucket)).size !== 6) {
    context.addIssue({
      code: "custom",
      message: "Jeder Fair-Use-Bucket muss genau einmal konfiguriert sein.",
      path: ["policies"],
    });
  }
});

export const RETRY_AFTER_ERROR_SCHEMA = z.object({
  code: z.literal("RATE_LIMITED"),
  message: z.string().trim().min(1).max(500),
  request_id: uuid,
  retryable: z.literal(true),
  retry_after_seconds: z.number().int().positive().max(86_400),
  required_scope: z.never().optional(),
}).strict();
