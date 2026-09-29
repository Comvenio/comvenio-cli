import { createHash } from "node:crypto";

import {
  createConnectorError,
  normalizeRequestContext,
  type JsonValue,
  type RequestContext,
  type UUID,
} from "@comvenio/connector-contracts";

import type { JobExecutorRegistry } from "./executors.ts";
import type { JobInputStore } from "./input-store.ts";
import { AsyncJobService, deterministicJobId } from "./service.ts";
import { JOB_METADATA_TTL_SECONDS } from "./types.ts";

/**
 * Lifetime of the signed job binding (D-CAI-023), fixed at job start and
 * covering queue wait and every retry; far below the auth-service maximum
 * of 24 h.
 */
export const JOB_BINDING_LIFETIME_MS = 60 * 60 * 1_000;

/** The call-level safety data of the running domain tool call (action, operation, idempotency key). */
export interface JobCallBinding {
  action_id: string;
  operation: string;
  idempotency_key: string | null;
}

/** Structural request shape shared by all K*JobStartPort variants. */
export interface DomainJobStartRequest {
  definition: { action_id: string };
  operation?: { operation: string };
  input: JsonValue;
  context: RequestContext;
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Name-based UUID (v5 layout) over the effect of the call: equal input -> equal reference. */
function operationReference(actionId: string, operation: string, input: JsonValue): UUID {
  const hex = createHash("sha256")
    .update(`job-operation\u0000${actionId}\u0000${operation}\u0000${canonical(input)}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function configInvalid(context: RequestContext, message: string): Error {
  return createConnectorError({ code: "CONFIG_INVALID", message, request_id: context.request_id, retryable: false });
}

/**
 * The job_starter handed to the domain tool sets (D-CAI-023). It starts a job
 * only for an operation with a registered executor, stores the action input
 * encrypted with the job's TTL and derives the job identity from the
 * idempotency key of the tool call. No token enters the job.
 */
export class DomainJobStarter {
  constructor(private readonly input: {
    jobs: AsyncJobService;
    inputs: JobInputStore;
    registry: JobExecutorRegistry;
    tool_name: (actionId: string) => string;
    call: () => JobCallBinding | undefined;
    now?: () => Date;
  }) {}

  supports(actionId: string, operation: string): boolean {
    return this.input.registry.supports(actionId, operation);
  }

  async start(request: DomainJobStartRequest): Promise<JsonValue> {
    const context = normalizeRequestContext(request.context);
    const actionId = request.definition.action_id;
    const operation = request.operation?.operation ?? "execute";
    const executor = this.input.registry.get(actionId, operation);
    if (!executor) throw configInvalid(context, "Für diese Aktion ist kein Hintergrundauftrag freigegeben.");
    const call = this.input.call();
    if (!call || call.action_id !== actionId || call.operation !== operation || !call.idempotency_key) {
      throw createConnectorError({
        code: "VALIDATION_FAILED",
        message: "Für diesen Jobstart fehlt ein gültiger Idempotenzschlüssel.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    if (!context.subject_id || !context.oauth_grant_id || !context.club_id) {
      throw createConnectorError({
        code: "AUTH_REQUIRED",
        message: "Für Jobaktionen ist eine aktive Verbindung mit gewähltem Verein erforderlich.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    const toolName = this.input.tool_name(actionId);
    const jobId = deterministicJobId({
      subject_id: context.subject_id,
      club_id: context.club_id,
      tool_name: toolName,
      idempotency_key: call.idempotency_key,
    });
    // The input is stored before the enqueue, so the worker never sees a job without it.
    // An existing envelope (idempotent retry) keeps its original binding expiry.
    const now = (this.input.now ?? (() => new Date()))();
    const stored = await this.input.inputs.put({
      job_id: jobId,
      action_id: actionId,
      operation,
      input: structuredClone(request.input),
      context,
      binding_expires_at: new Date(now.getTime() + JOB_BINDING_LIFETIME_MS).toISOString(),
    }, JOB_METADATA_TTL_SECONDS * 1_000);
    try {
      const handle = await this.input.jobs.start({
        context,
        club_id: context.club_id,
        tool_name: toolName,
        operation_reference: operationReference(actionId, operation, request.input),
        idempotency_key: call.idempotency_key,
        fair_use_bucket: executor.fair_use_bucket,
        cancellable: executor.cancellable,
      });
      // A retry of a job that already ran: its input was consumed, the fresh copy is not needed.
      if (stored && ["succeeded", "failed", "cancelled", "expired"].includes(handle.state)) await this.input.inputs.delete(jobId);
      return structuredClone(handle) as unknown as JsonValue;
    } catch (error) {
      if (stored) await this.input.inputs.delete(jobId);
      throw error;
    }
  }
}
