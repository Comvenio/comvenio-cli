export const MAX_INLINE_JOB_ITEMS = 100;
export const MAX_INLINE_JOB_RESPONSE_BYTES = 256 * 1024;
export const MAX_INLINE_JOB_DURATION_MS = 8_000;

export interface JobExecutionEstimate {
  item_count: number;
  response_bytes: number;
  expected_duration_ms: number;
}

export function requiresAsyncJob(estimate: JobExecutionEstimate): boolean {
  if (!Number.isSafeInteger(estimate.item_count) || estimate.item_count < 0) return true;
  if (!Number.isSafeInteger(estimate.response_bytes) || estimate.response_bytes < 0) return true;
  if (!Number.isSafeInteger(estimate.expected_duration_ms) || estimate.expected_duration_ms < 0) return true;
  return estimate.item_count > MAX_INLINE_JOB_ITEMS
    || estimate.response_bytes > MAX_INLINE_JOB_RESPONSE_BYTES
    || estimate.expected_duration_ms > MAX_INLINE_JOB_DURATION_MS;
}
