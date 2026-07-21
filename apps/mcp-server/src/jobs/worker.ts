import { Worker, type ConnectionOptions } from "bullmq";

import {
  COMVENIO_JOB_QUEUE_NAME,
  type InternalJobRecord,
  type JobProcessorPort,
  type JobProcessorResult,
} from "./types.ts";
import type { BullMqJobQueue } from "./bullmq.ts";
import type { FairUseService } from "./fair-use.ts";

interface BullJobData { record: InternalJobRecord; }

export function createComvenioJobWorker(input: {
  connection: ConnectionOptions;
  processor: JobProcessorPort;
  queue?: BullMqJobQueue;
  prefix?: string;
  concurrency?: number;
  onSettled?: (record: InternalJobRecord) => void | Promise<void>;
  onLifecycleError?: (error: unknown) => void;
  fairUse?: FairUseService;
}): Worker<BullJobData, JobProcessorResult> {
  const worker = new Worker<BullJobData, JobProcessorResult>(
    COMVENIO_JOB_QUEUE_NAME,
    async (job, _token, signal) => {
      return input.processor.process({
        record: structuredClone(job.data.record),
        signal,
        async reportProgress(percent) {
          if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
            throw new Error("Jobfortschritt muss zwischen 0 und 100 liegen.");
          }
          await job.updateProgress(percent);
        },
      });
    },
    {
      connection: input.connection,
      prefix: input.prefix ?? "comvenio",
      concurrency: input.concurrency ?? 4,
    },
  );

  const settledJobIds = new Set<string>();
  async function settle(job: { id?: string; data: BullJobData }): Promise<void> {
    const jobId = job.id ?? job.data.record.handle.job_id;
    if (settledJobIds.has(jobId)) return;
    settledJobIds.add(jobId);
    try {
      if (job.data.record.heavy_slot_key && input.fairUse) {
        await input.fairUse.releaseHeavy(job.data.record.heavy_slot_key, job.data.record.handle.job_id);
      }
      await input.onSettled?.(structuredClone(job.data.record));
    } catch (error) {
      settledJobIds.delete(jobId);
      input.onLifecycleError?.(error);
    }
  }

  worker.on("completed", (job) => { void settle(job); });
  worker.on("failed", (job) => {
    if (!job) return;
    void job.getState()
      .then((state) => state === "failed" ? settle(job) : undefined)
      .catch((error: unknown) => input.onLifecycleError?.(error));
  });
  input.queue?.attachActiveCanceller((jobId) => worker.cancelJob(jobId, "Vom berechtigten Nutzer abgebrochen."));
  return worker;
}
