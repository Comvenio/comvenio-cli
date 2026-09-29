import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { RequestContext } from "@comvenio/connector-contracts";
import { UnrecoverableError } from "bullmq";

import { ConnectorFileService } from "../files/service.ts";
import type { FileMetadataStore, MalwareScannerPort, QuarantineObjectPort } from "../files/types.ts";
import { SnapshotFileAuthorization } from "./authorization.ts";
import type { FetchLike, JobExecutorRegistry } from "./executors.ts";
import type { JobInputStore } from "./input-store.ts";
import { JobActorRevokedError, type JobActorPort } from "./job-actor.ts";
import type { InternalJobRecord, JobProcessorPort, JobProcessorResult } from "./types.ts";

/**
 * Fixed, payload-free failure texts. BullMQ persists the message as
 * failedReason, so it must never carry input, file names or upstream answers.
 */
const FAILED = "Der Hintergrundauftrag ist fehlgeschlagen.";
const RETRY = "Der Hintergrundauftrag wird erneut versucht.";

export interface JobCapabilityPort {
  resolve(input: { context: RequestContext; backend_actor_token: string }): Promise<CapabilitySnapshot>;
}

export interface DomainJobProcessorDependencies {
  inputs: JobInputStore;
  registry: JobExecutorRegistry;
  actors: JobActorPort;
  capabilities: JobCapabilityPort;
  client_for: (backendActorToken: string) => ComvenioApiClient;
  file_metadata: FileMetadataStore;
  objects: QuarantineObjectPort;
  scanner: MalwareScannerPort;
  tool_name: (actionId: string) => string;
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives only the error class name, never the error itself. */
  on_failure?: (event: { job_id: string; action_id: string | null; reason: string }) => void;
}

function sameBinding(record: InternalJobRecord, envelope: Awaited<ReturnType<JobInputStore["get"]>>, toolName: (actionId: string) => string): boolean {
  if (!envelope) return false;
  const context = envelope.context;
  return envelope.job_id === record.handle.job_id
    && context.subject_id === record.handle.subject_id
    && context.club_id === record.handle.club_id
    && context.oauth_grant_id === record.oauth_grant_id
    && toolName(envelope.action_id) === record.handle.tool_name
    && Number.isFinite(Date.parse(envelope.binding_expires_at));
}

/**
 * Worker-side dispatcher by action_id and operation. Before any call to a
 * domain service it obtains a job actor (D-CAI-023); the actor is used only
 * for this run and never stored. The executor obtains a fresh actor again
 * immediately before each side effect, always with the binding expiry fixed
 * at job start.
 */
export class DomainJobProcessor implements JobProcessorPort {
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(private readonly dependencies: DomainJobProcessorDependencies) {
    this.#fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = dependencies.now ?? (() => new Date());
  }

  async process(input: {
    record: InternalJobRecord;
    signal?: AbortSignal;
    reportProgress(percent: number): Promise<void>;
  }): Promise<JobProcessorResult> {
    const { record } = input;
    const jobId = record.handle.job_id;
    const envelope = await this.dependencies.inputs.get(jobId);
    const actionId = envelope?.action_id ?? null;
    const fail = async (reason: string): Promise<never> => {
      await this.dependencies.inputs.delete(jobId).catch(() => undefined);
      this.dependencies.on_failure?.({ job_id: jobId, action_id: actionId, reason });
      throw new UnrecoverableError(FAILED);
    };
    if (!envelope || !sameBinding(record, envelope, this.dependencies.tool_name)) return fail("input_missing_or_mismatched");
    const executor = this.dependencies.registry.get(envelope.action_id, envelope.operation);
    if (!executor) return fail("executor_missing");
    if (input.signal?.aborted) return fail("aborted");

    const context = envelope.context;
    const exchange = async (): Promise<string> => (await this.dependencies.actors.exchange({
      request_id: record.request_id,
      job_id: jobId,
      action_id: envelope.action_id,
      grant_id: record.oauth_grant_id,
      subject_id: record.handle.subject_id,
      club_id: record.handle.club_id,
      scopes: executor.required_scopes.filter((scope) => context.scopes.includes(scope)),
      // Fixed at job start and stored with the input: a retry never extends it.
      expires_at: envelope.binding_expires_at,
    })).access_token;
    let token: string;
    try {
      token = await exchange();
    } catch (error) {
      if (error instanceof JobActorRevokedError) return fail("actor_revoked");
      // Nothing was consumed yet: BullMQ may retry with backoff.
      this.dependencies.on_failure?.({ job_id: jobId, action_id: actionId, reason: "actor_unavailable" });
      throw new Error(RETRY);
    }

    // Every file authorization resolves a fresh snapshot with the latest actor, never a cached one.
    const files = new ConnectorFileService(
      this.dependencies.file_metadata,
      this.dependencies.objects,
      this.dependencies.scanner,
      new SnapshotFileAuthorization(
        () => this.dependencies.capabilities.resolve({ context, backend_actor_token: token }),
        this.#now,
      ),
    );
    try {
      await executor.execute({
        record,
        envelope,
        freshActor: async () => {
          if (input.signal?.aborted) throw new Error("aborted");
          token = await exchange();
          return this.dependencies.client_for(token);
        },
        files,
        file_metadata: this.dependencies.file_metadata,
        objects: this.dependencies.objects,
        fetch: this.#fetch,
        signal: input.signal,
        reportProgress: input.reportProgress,
      });
    } catch (error) {
      // After the executor started, the connector file may already be consumed: no retry.
      return fail(error instanceof Error ? error.name : "executor_failed");
    }
    await this.dependencies.inputs.delete(jobId);
    return { result_file_id: null, error_code: null };
  }
}
