import { describe, expect, test } from "bun:test";

import {
  ASYNC_JOB_HANDLE_SCHEMA,
  RATE_LIMIT_CONFIG_SCHEMA,
  MemoryAtomicSafetyStore,
  WriteSafetyService,
  isConnectorError,
  type RequestContext,
} from "@comvenio/connector-contracts";
import {
  AsyncJobService,
  COMVENIO_JOB_QUEUE_NAME,
  FairUseService,
  JobCancelTool,
  JobStatusTool,
  MemoryFairUseStore,
  MemoryJobQueue,
  MAX_INLINE_JOB_DURATION_MS,
  MAX_INLINE_JOB_ITEMS,
  MAX_INLINE_JOB_RESPONSE_BYTES,
  bundledRateLimitConfig,
  fairUseConfigReadiness,
  nextJobPollDelayMs,
  requiresAsyncJob,
  type JobAuthorizationPort,
  type JobClock,
} from "../../../apps/mcp-server/src/jobs/index.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const otherSubjectId = "23232323-2323-4232-8232-232323232323";
const clubId = "33333333-3333-4333-8333-333333333333";
const otherClubId = "34343434-3434-4434-8434-343434343434";
const grantId = "44444444-4444-4444-8444-444444444444";
const operationReference = "55555555-5555-4555-8555-555555555555";
const secondOperationReference = "56565656-5656-4656-8656-565656565656";
const idempotencyKey = "66666666-6666-4666-8666-666666666666";
const secondIdempotencyKey = "67676767-6767-4676-8676-676767676767";
const resultFileId = "77777777-7777-4777-8777-777777777777";
const toolName = "cv_member_import_write_12345678";

const context: RequestContext = {
  request_id: requestId,
  surface: "mcp",
  provider: "openai",
  subject_id: subjectId,
  oauth_grant_id: grantId,
  club_id: clubId,
  department_id: null,
  scopes: ["member.write", "files.import"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

class MutableClock implements JobClock {
  constructor(private timestamp = Date.parse("2026-07-21T12:00:00.000Z")) {}
  now(): Date { return new Date(this.timestamp); }
  advance(seconds: number): void { this.timestamp += seconds * 1_000; }
}

function fixture() {
  const queue = new MemoryJobQueue();
  const clock = new MutableClock();
  let authorized = true;
  let authorizationCalls = 0;
  const authorization: JobAuthorizationPort = {
    async reauthorize(input) {
      authorizationCalls++;
      if (!authorized) {
        throw Object.assign(new Error("permission revoked"), {
          code: "PERMISSION_DENIED",
          request_id: input.context.request_id,
          retryable: false,
        });
      }
      return { capability_version: "cap-v1" };
    },
  };
  const fairUse = new FairUseService(bundledRateLimitConfig(), new MemoryFairUseStore(), () => clock.now());
  return {
    queue,
    clock,
    fairUse,
    service: new AsyncJobService(queue, authorization, fairUse, clock),
    deny() { authorized = false; },
    authorizationCalls() { return authorizationCalls; },
  };
}

function startRequest(overrides: Partial<Parameters<AsyncJobService["start"]>[0]> = {}) {
  return {
    context,
    club_id: clubId,
    tool_name: toolName,
    operation_reference: operationReference,
    idempotency_key: idempotencyKey,
    fair_use_bucket: "heavy_job" as const,
    cancellable: true,
    ...overrides,
  };
}

describe("K15 jobs and fair-use contract", () => {
  test("TC-01: publishes the exact entities, queue name and versioned numeric policy", async () => {
    const config = bundledRateLimitConfig();
    expect(RATE_LIMIT_CONFIG_SCHEMA.parse(config)).toEqual(config);
    expect(COMVENIO_JOB_QUEUE_NAME).toBe("comvenio-mcp-jobs-v1");
    expect(config).toEqual({
      contract_version: "1.0.0",
      policies: [
        { bucket: "public_read", limit: 60, window_seconds: 60, key_dimensions: ["ip", "club_id"] },
        { bucket: "private_read", limit: 120, window_seconds: 60, key_dimensions: ["subject_id", "club_id"] },
        { bucket: "reversible_write", limit: 20, window_seconds: 60, key_dimensions: ["subject_id", "club_id"] },
        { bucket: "critical_flow", limit: 10, window_seconds: 60, key_dimensions: ["subject_id", "club_id"] },
        { bucket: "import_export", limit: 3, window_seconds: 3600, key_dimensions: ["subject_id", "club_id"] },
        { bucket: "heavy_job", limit: 5, window_seconds: 3600, key_dimensions: ["subject_id", "club_id"] },
      ],
      max_concurrent_heavy_jobs_per_subject_club: 1,
      polling_seconds: [1, 2, 4, 8, 15],
      polling_jitter_percent: 20,
    });
    expect(await fairUseConfigReadiness(config).check()).toBe(true);
    expect(await fairUseConfigReadiness({}).check()).toBe(false);
    expect(() => RATE_LIMIT_CONFIG_SCHEMA.parse({ ...config, policies: config.policies.slice(1) })).toThrow();

    const setup = fixture();
    expect(new JobStatusTool(setup.service).tool_name).toBe("cv_job_status_read");
    expect(new JobCancelTool(setup.service).tool_name).toBe("cv_job_cancel_write");
    expect(config.polling_seconds.map((_value, attempt) => nextJobPollDelayMs(attempt, config, () => 0.5)))
      .toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
    expect(nextJobPollDelayMs(99, config, () => 0)).toBe(12_000);
    expect(nextJobPollDelayMs(99, config, () => 0.999999)).toBe(18_000);
    expect(requiresAsyncJob({
      item_count: MAX_INLINE_JOB_ITEMS,
      response_bytes: MAX_INLINE_JOB_RESPONSE_BYTES,
      expected_duration_ms: MAX_INLINE_JOB_DURATION_MS,
    })).toBe(false);
    expect(requiresAsyncJob({ item_count: MAX_INLINE_JOB_ITEMS + 1, response_bytes: 1, expected_duration_ms: 1 })).toBe(true);
    expect(requiresAsyncJob({ item_count: 1, response_bytes: MAX_INLINE_JOB_RESPONSE_BYTES + 1, expected_duration_ms: 1 })).toBe(true);
    expect(requiresAsyncJob({ item_count: 1, response_bytes: 1, expected_duration_ms: MAX_INLINE_JOB_DURATION_MS + 1 })).toBe(true);
    expect(requiresAsyncJob({ item_count: -1, response_bytes: 1, expected_duration_ms: 1 })).toBe(true);
  });

  test("TC-02: follows queued/running/succeeded lifecycle with safe progress and result reference", async () => {
    const setup = fixture();
    const statusTool = new JobStatusTool(setup.service);
    const started = await setup.service.start(startRequest());
    expect(ASYNC_JOB_HANDLE_SCHEMA.parse(started)).toEqual(started);
    expect(started).toMatchObject({
      subject_id: subjectId,
      club_id: clubId,
      tool_name: toolName,
      state: "queued",
      progress_percent: 0,
      result_file_id: null,
    });

    await setup.queue.update(started.job_id, {
      state: "running",
      progress_percent: 45,
      started_at: "2026-07-21T12:00:01.000Z",
    });
    expect(await statusTool.execute({ context, club_id: clubId, job_id: started.job_id })).toMatchObject({
      state: "running",
      progress_percent: 45,
    });

    await setup.queue.update(started.job_id, {
      state: "succeeded",
      progress_percent: 100,
      finished_at: "2026-07-21T12:00:05.000Z",
      result_file_id: resultFileId,
    });
    expect(await statusTool.execute({ context, club_id: clubId, job_id: started.job_id })).toMatchObject({
      state: "succeeded",
      progress_percent: 100,
      result_file_id: resultFileId,
      error_code: null,
    });
    expect(setup.authorizationCalls()).toBe(3);
  });

  test("TC-03: one heavy slot blocks a second job without exposing bucket counts", async () => {
    const setup = fixture();
    const first = await setup.service.start(startRequest());
    const replay = await setup.service.start(startRequest());
    expect(replay).toEqual(first);

    try {
      await setup.service.start(startRequest({
        operation_reference: secondOperationReference,
        idempotency_key: secondIdempotencyKey,
      }));
      throw new Error("Der zweite schwere Job wurde unerwartet gestartet.");
    } catch (error) {
      expect(isConnectorError(error)).toBe(true);
      if (isConnectorError(error)) {
        expect(error.code).toBe("RATE_LIMITED");
        expect(error.retry_after_seconds).toBeGreaterThan(0);
        expect(error.message).not.toContain("1");
        expect(error.message).not.toContain(subjectId);
      }
    }
  });

  test("enforces the authenticated-read load boundary under concurrent requests", async () => {
    const config = bundledRateLimitConfig();
    const fairUse = new FairUseService(config, new MemoryFairUseStore(), () => new Date("2026-07-21T12:00:00.000Z"));
    const calls = Array.from({ length: 121 }, () => fairUse.assertAllowed({
      bucket: "private_read",
      dimensions: { subject_id: subjectId, club_id: clubId },
      request_id: requestId,
    }));
    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(120);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "RATE_LIMITED", retry_after_seconds: 60 });
  });

  test("TC-04: status and cancel hide jobs of another subject, grant or club", async () => {
    const setup = fixture();
    const started = await setup.service.start(startRequest());
    const statusTool = new JobStatusTool(setup.service);
    const cancelTool = new JobCancelTool(setup.service);
    const foreignSubject = { ...context, subject_id: otherSubjectId };
    const foreignGrant = { ...context, oauth_grant_id: "88888888-8888-4888-8888-888888888888" };

    await expect(statusTool.execute({ context: foreignSubject, club_id: clubId, job_id: started.job_id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelTool.execute({ context: foreignGrant, club_id: clubId, job_id: started.job_id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(statusTool.execute({ context: { ...context, club_id: otherClubId }, club_id: clubId, job_id: started.job_id }))
      .rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(setup.authorizationCalls()).toBe(1);
  });

  test("TC-05: a personal export starts only inside a valid critical confirmation", async () => {
    const setup = fixture();
    let jobStarts = 0;
    const safety = new WriteSafetyService({
      store: new MemoryAtomicSafetyStore(),
      authorization: { async reauthorize() { return { capability_version: "cap-v1" }; } },
    });
    const preview = await safety.createCriticalPreview({
      context: { ...context, scopes: ["member.read.details", "files.export"] },
      operation: { tool_name: "cv_member_export_write_12345678", risk_class: "critical_write", execution_mode: "async_job" },
      normalized_input: { club_id: clubId, export_scope: "personal" },
      target: { type: "member_export", id: null, label: "Mitgliederexport" },
      impact: { creates: 0, updates: 0, deletes: 0, publishes: 0, imports: 0, exports: 1, affected_total: 1, summary: "Eine personenbezogene Exportdatei wird erzeugt." },
      masked_fields: ["email", "birthdate"],
      safe_summary: "Ein personenbezogener Mitgliederexport wird gestartet.",
      object_version: "members-v1",
    });
    expect(jobStarts).toBe(0);

    await safety.confirmCriticalWrite({
      context: { ...context, scopes: ["member.read.details", "files.export"] },
      tool_name: "cv_member_export_write_12345678",
      preview_id: preview.preview.preview_id,
      confirmation_token: preview.confirmation_token,
      idempotency_key: idempotencyKey,
      current_object_version: "members-v1",
    }, async () => {
      jobStarts++;
      await setup.service.start(startRequest({ fair_use_bucket: "import_export" }));
      return { target_ids: [], changed_count: 1, unchanged_count: 0, failed_count: 0, result_summary: "Der Exportjob wurde gestartet.", object_versions: [], safe_next_actions: [] };
    });
    expect(jobStarts).toBe(1);
  });

  test("TC-06: job start is idempotent and expired handles cannot be revived", async () => {
    const setup = fixture();
    const first = await setup.service.start(startRequest());
    const retry = await setup.service.start(startRequest());
    expect(retry.job_id).toBe(first.job_id);

    setup.clock.advance(7 * 24 * 60 * 60 + 1);
    const expired = await setup.service.status({ context, club_id: clubId, job_id: first.job_id });
    expect(expired.state).toBe("expired");
    await expect(setup.service.cancel({ context, club_id: clubId, job_id: first.job_id }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});
