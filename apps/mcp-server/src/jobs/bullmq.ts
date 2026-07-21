import { Queue, type Job, type JobState as BullJobState } from "bullmq";

import {
  ASYNC_JOB_HANDLE_SCHEMA,
  type AsyncJobHandle,
  type UUID,
} from "@comvenio/connector-contracts";

import {
  COMVENIO_JOB_QUEUE_NAME,
  JOB_METADATA_TTL_SECONDS,
  type BullMqJobQueueOptions,
  type InternalJobRecord,
  type JobProcessorResult,
  type JobQueuePort,
} from "./types.ts";

interface BullJobData { record: InternalJobRecord; }

function clone<T>(value: T): T { return structuredClone(value); }

function stateFromBull(state: BullJobState | "unknown"): AsyncJobHandle["state"] {
  if (state === "active") return "running";
  if (state === "completed") return "succeeded";
  if (state === "failed") return "failed";
  return "queued";
}

export class BullMqJobQueue implements JobQueuePort {
  readonly queue: Queue<BullJobData, JobProcessorResult>;
  #activeCanceller: ((jobId: UUID) => boolean) | null = null;

  constructor(options: BullMqJobQueueOptions) {
    this.queue = new Queue<BullJobData, JobProcessorResult>(COMVENIO_JOB_QUEUE_NAME, {
      connection: options.connection,
      prefix: options.prefix ?? "comvenio",
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: JOB_METADATA_TTL_SECONDS, count: 100_000 },
        removeOnFail: { age: JOB_METADATA_TTL_SECONDS, count: 100_000 },
      },
    });
  }

  attachActiveCanceller(canceller: (jobId: UUID) => boolean): void {
    this.#activeCanceller = canceller;
  }

  async get(jobId: UUID): Promise<InternalJobRecord | null> {
    const metadata = await this.#readMetadata(jobId);
    if (metadata?.handle.state === "cancelled") return metadata;
    const job = await this.queue.getJob(jobId);
    if (!job) return metadata;
    return this.#project(job);
  }

  async enqueue(record: InternalJobRecord): Promise<InternalJobRecord> {
    await this.queue.add(record.handle.tool_name, { record: clone(record) }, {
      jobId: record.handle.job_id,
    });
    const actual = await this.queue.getJob(record.handle.job_id);
    if (!actual) throw new Error("BullMQ hat den Jobstart nicht dauerhaft bestätigt.");
    const projected = await this.#project(actual);
    await this.#writeMetadata(projected);
    return projected;
  }

  async cancel(jobId: UUID, now: string): Promise<InternalJobRecord | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    const record = await this.#project(job);
    if (!record.cancellable) return null;
    const state = await job.getState();
    if (state === "active") {
      if (!this.#activeCanceller?.(jobId)) return null;
    } else if (["waiting", "delayed", "prioritized", "paused", "waiting-children"].includes(state)) {
      await job.remove();
    } else {
      return null;
    }
    record.handle.state = "cancelled";
    record.handle.finished_at = now;
    record.handle.progress_percent = null;
    record.handle.error_code = null;
    await this.#writeMetadata(record);
    return clone(record);
  }

  async readiness(): Promise<boolean> {
    try {
      await this.queue.waitUntilReady();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> { await this.queue.close(); }

  async #project(job: Job<BullJobData, JobProcessorResult>): Promise<InternalJobRecord> {
    const record = clone(job.data.record);
    const state = await job.getState();
    const progress = typeof job.progress === "number" && Number.isInteger(job.progress)
      ? Math.min(100, Math.max(0, job.progress))
      : record.handle.progress_percent;
    record.handle = ASYNC_JOB_HANDLE_SCHEMA.parse({
      ...record.handle,
      state: stateFromBull(state),
      progress_percent: progress,
      started_at: job.processedOn ? new Date(job.processedOn).toISOString() : record.handle.started_at,
      finished_at: job.finishedOn ? new Date(job.finishedOn).toISOString() : record.handle.finished_at,
      result_file_id: state === "completed" ? job.returnvalue?.result_file_id ?? null : record.handle.result_file_id,
      error_code: state === "failed" ? job.returnvalue?.error_code ?? "UPSTREAM_UNAVAILABLE" : null,
    });
    return record;
  }

  #metadataKey(jobId: UUID): string { return `mcp:job:${jobId}`; }

  async #readMetadata(jobId: UUID): Promise<InternalJobRecord | null> {
    const redis = await this.queue.client;
    const value = await redis.get(this.#metadataKey(jobId));
    if (!value) return null;
    try { return JSON.parse(value) as InternalJobRecord; }
    catch { throw new Error("Die gespeicherten Jobmetadaten sind ungültig."); }
  }

  async #writeMetadata(record: InternalJobRecord): Promise<void> {
    const redis = await this.queue.client;
    await redis.set(this.#metadataKey(record.handle.job_id), JSON.stringify(record), {
      EX: JOB_METADATA_TTL_SECONDS,
    });
  }
}
