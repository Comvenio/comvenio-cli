import type { UUID } from "@comvenio/connector-contracts";

import type { InternalJobRecord, JobQueuePort } from "./types.ts";

export class MemoryJobQueue implements JobQueuePort {
  readonly #records = new Map<UUID, InternalJobRecord>();
  available = true;

  async get(jobId: UUID): Promise<InternalJobRecord | null> {
    const record = this.#records.get(jobId);
    return record ? structuredClone(record) : null;
  }

  async enqueue(record: InternalJobRecord): Promise<InternalJobRecord> {
    const existing = this.#records.get(record.handle.job_id);
    if (existing) return structuredClone(existing);
    this.#records.set(record.handle.job_id, structuredClone(record));
    return structuredClone(record);
  }

  async cancel(jobId: UUID, now: string): Promise<InternalJobRecord | null> {
    const record = this.#records.get(jobId);
    if (!record || !record.cancellable || !["queued", "running"].includes(record.handle.state)) return null;
    record.handle.state = "cancelled";
    record.handle.finished_at = now;
    record.handle.progress_percent = null;
    return structuredClone(record);
  }

  async readiness(): Promise<boolean> { return this.available; }
  async close(): Promise<void> {}

  async update(jobId: UUID, update: Partial<InternalJobRecord["handle"]>): Promise<void> {
    const record = this.#records.get(jobId);
    if (!record) throw new Error("Der Testjob wurde nicht gefunden.");
    Object.assign(record.handle, structuredClone(update));
  }
}
