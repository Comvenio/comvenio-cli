import { createHash } from "node:crypto";

import {
  ASYNC_JOB_HANDLE_SCHEMA,
  JOB_CANCEL_INPUT_SCHEMA,
  JOB_STATUS_INPUT_SCHEMA,
  createConnectorError,
  normalizeRequestContext,
  type AsyncJobHandle,
  type RequestContext,
  type UUID,
} from "@comvenio/connector-contracts";

import { FairUseService } from "./fair-use.ts";
import {
  JOB_METADATA_TTL_SECONDS,
  type InternalJobRecord,
  type JobAuthorizationPort,
  type JobClock,
  type JobQueuePort,
  type JobStartRequest,
} from "./types.ts";

const SYSTEM_CLOCK: JobClock = { now: () => new Date() };

function deterministicJobId(input: {
  subject_id: UUID;
  club_id: UUID;
  tool_name: string;
  idempotency_key: UUID;
}): UUID {
  const hex = createHash("sha256")
    .update(`${input.subject_id}\u0000${input.club_id}\u0000${input.tool_name}\u0000${input.idempotency_key}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function bound(contextInput: RequestContext, explicitClubId: UUID): {
  context: RequestContext;
  subject_id: UUID;
  club_id: UUID;
  oauth_grant_id: UUID;
} {
  const context = normalizeRequestContext(contextInput);
  if (!context.subject_id || !context.oauth_grant_id) {
    throw createConnectorError({ code: "AUTH_REQUIRED", message: "Für Jobaktionen ist eine aktive Verbindung erforderlich.", request_id: context.request_id, retryable: false });
  }
  if (!context.club_id) {
    throw createConnectorError({ code: "CLUB_SELECTION_REQUIRED", message: "Für Jobaktionen muss genau ein Verein gewählt sein.", request_id: context.request_id, retryable: false });
  }
  if (context.club_id !== explicitClubId) {
    throw createConnectorError({ code: "TENANT_MISMATCH", message: "Der Job gehört nicht zum ausgewählten Verein.", request_id: context.request_id, retryable: false });
  }
  return { context, subject_id: context.subject_id, club_id: context.club_id, oauth_grant_id: context.oauth_grant_id };
}

function terminal(state: AsyncJobHandle["state"]): boolean {
  return ["succeeded", "failed", "cancelled", "expired"].includes(state);
}

export class AsyncJobService {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly authorization: JobAuthorizationPort,
    private readonly fairUse: FairUseService,
    private readonly clock: JobClock = SYSTEM_CLOCK,
  ) {}

  async start(request: JobStartRequest): Promise<AsyncJobHandle> {
    const { context, subject_id, club_id, oauth_grant_id } = bound(request.context, request.club_id);
    const authorization = await this.authorization.reauthorize({ context, tool_name: request.tool_name, action: "start" });
    const jobId = deterministicJobId({ subject_id, club_id, tool_name: request.tool_name, idempotency_key: request.idempotency_key });
    const existing = await this.queue.get(jobId);
    if (existing) return this.#idempotentResult(existing, request, context);

    await this.fairUse.assertAllowed({
      bucket: request.fair_use_bucket,
      dimensions: { subject_id, club_id },
      request_id: context.request_id,
    });
    const heavySlotKey = request.fair_use_bucket === "heavy_job"
      ? await this.fairUse.acquireHeavy({ subject_id, club_id, job_id: jobId, request_id: context.request_id })
      : null;
    const now = this.clock.now();
    const record: InternalJobRecord = {
      handle: {
        job_id: jobId,
        subject_id,
        club_id,
        tool_name: request.tool_name,
        state: "queued",
        progress_percent: 0,
        created_at: now.toISOString(),
        started_at: null,
        finished_at: null,
        expires_at: new Date(now.getTime() + JOB_METADATA_TTL_SECONDS * 1_000).toISOString(),
        result_file_id: null,
        error_code: null,
      },
      request_id: context.request_id,
      oauth_grant_id,
      capability_version: authorization.capability_version,
      operation_reference: request.operation_reference,
      idempotency_key: request.idempotency_key,
      fair_use_bucket: request.fair_use_bucket,
      heavy_slot_key: heavySlotKey,
      cancellable: request.cancellable,
    };
    try {
      const queued = await this.queue.enqueue(record);
      return this.#idempotentResult(queued, request, context);
    } catch (error) {
      if (heavySlotKey) await this.fairUse.releaseHeavy(heavySlotKey, jobId);
      throw error;
    }
  }

  async status(input: { context: RequestContext; club_id: UUID; job_id: UUID }): Promise<AsyncJobHandle> {
    const parsed = JOB_STATUS_INPUT_SCHEMA.parse({ club_id: input.club_id, job_id: input.job_id });
    const binding = bound(input.context, parsed.club_id);
    const record = await this.#owned(parsed.job_id, binding.subject_id, binding.club_id, binding.oauth_grant_id, binding.context);
    await this.authorization.reauthorize({ context: binding.context, tool_name: record.handle.tool_name, action: "status" });
    const handle = this.#expire(record.handle);
    if (terminal(handle.state) && record.heavy_slot_key) await this.fairUse.releaseHeavy(record.heavy_slot_key, handle.job_id);
    return ASYNC_JOB_HANDLE_SCHEMA.parse(handle);
  }

  async cancel(input: { context: RequestContext; club_id: UUID; job_id: UUID }): Promise<AsyncJobHandle> {
    const parsed = JOB_CANCEL_INPUT_SCHEMA.parse({ club_id: input.club_id, job_id: input.job_id });
    const binding = bound(input.context, parsed.club_id);
    const record = await this.#owned(parsed.job_id, binding.subject_id, binding.club_id, binding.oauth_grant_id, binding.context);
    await this.authorization.reauthorize({ context: binding.context, tool_name: record.handle.tool_name, action: "cancel" });
    if (terminal(this.#expire(record.handle).state)) {
      throw createConnectorError({ code: "CONFLICT", message: "Der Job kann in seinem aktuellen Zustand nicht mehr abgebrochen werden.", request_id: binding.context.request_id, retryable: false });
    }
    const cancelled = await this.queue.cancel(record.handle.job_id, this.clock.now().toISOString());
    if (!cancelled) {
      throw createConnectorError({ code: "CONFLICT", message: "Der Job hat bereits einen nicht mehr abbrechbaren Verarbeitungsschritt erreicht.", request_id: binding.context.request_id, retryable: false });
    }
    if (cancelled.heavy_slot_key) await this.fairUse.releaseHeavy(cancelled.heavy_slot_key, cancelled.handle.job_id);
    return ASYNC_JOB_HANDLE_SCHEMA.parse(cancelled.handle);
  }

  async #owned(jobId: UUID, subjectId: UUID, clubId: UUID, grantId: UUID, context: RequestContext): Promise<InternalJobRecord> {
    const record = await this.queue.get(jobId);
    if (!record || record.handle.subject_id !== subjectId || record.handle.club_id !== clubId || record.oauth_grant_id !== grantId) {
      throw createConnectorError({ code: "NOT_FOUND", message: "Der Job ist im aktuellen Vereinskontext nicht verfügbar.", request_id: context.request_id, retryable: false });
    }
    return record;
  }

  #expire(handleInput: AsyncJobHandle): AsyncJobHandle {
    const handle = structuredClone(handleInput);
    if (!terminal(handle.state) && Date.parse(handle.expires_at) <= this.clock.now().getTime()) {
      handle.state = "expired";
      handle.finished_at = this.clock.now().toISOString();
      handle.error_code = null;
      handle.progress_percent = null;
    }
    return handle;
  }

  #idempotentResult(record: InternalJobRecord, request: JobStartRequest, context: RequestContext): AsyncJobHandle {
    if (record.handle.subject_id !== context.subject_id
      || record.handle.club_id !== request.club_id
      || record.handle.tool_name !== request.tool_name
      || record.operation_reference !== request.operation_reference
      || record.idempotency_key !== request.idempotency_key) {
      throw createConnectorError({ code: "CONFLICT", message: "Der Idempotenzschlüssel gehört zu einem anderen Jobauftrag.", request_id: context.request_id, retryable: false });
    }
    return ASYNC_JOB_HANDLE_SCHEMA.parse(this.#expire(record.handle));
  }
}
